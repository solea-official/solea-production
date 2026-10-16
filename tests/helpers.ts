import { mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { readFile, readdir } from "node:fs/promises";
import { NextRequest } from "next/server";
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  ADMIN_MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  DATABASE_URL: "postgresql://test-only",
  INSTAPAY_ENABLED: "true",
  INSTAPAY_ACCOUNT: "test-instapay",
  INSTAPAY_QR_URL: "https://qr.example.invalid/instapay.svg",
  VODAFONE_CASH_ENABLED: "true",
  VODAFONE_CASH_NUMBER: "01000000000",
  VODAFONE_CASH_QR_URL: "https://qr.example.invalid/vodafone.svg",
  PAYMENT_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  BOSTA_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  MEDIA_DIR: "./var/automated-test-media",
});
export const engine = new PGlite();
await engine.waitReady;
await engine.exec(
  "CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
);
for (const file of (await readdir("migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort())
  await engine.exec(await readFile("migrations/" + file, "utf8"));
let lock = Promise.resolve();
async function acquire() {
  let release!: () => void;
  const previous = lock;
  lock = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  return release;
}
async function query(
  statement: string | { text: string; values?: unknown[]; rowMode?: string },
  values?: unknown[],
) {
  const text = typeof statement === "string" ? statement : statement.text;
  const args =
    values || (typeof statement === "string" ? [] : statement.values) || [];
  const r = await engine.query(text, args);
  let rows = r.rows;
  if (typeof statement !== "string" && statement.rowMode === "array")
    rows = rows.map((x) => Object.values(x as object));
  return { rows, rowCount: r.affectedRows || rows.length, fields: r.fields };
}
const testPool = {
  query: async (s: Parameters<typeof query>[0], v?: unknown[]) => {
    const done = await acquire();
    try {
      return await query(s, v);
    } finally {
      done();
    }
  },
  connect: async () => {
    const done = await acquire();
    return { query, release: done };
  },
  end: async () => {},
};
(globalThis as unknown as { soleaPool: Pool }).soleaPool =
  testPool as unknown as Pool;
const stored = new Map<string, Buffer>();
export function storedObject(bucket: string, path: string) {
  return stored.get(`${bucket}/${path}`);
}
(globalThis as unknown as { soleaStorageProvider: unknown }).soleaStorageProvider = {
  async upload(bucket: string, path: string, data: Buffer) {
    stored.set(`${bucket}/${path}`, data);
    return path;
  },
  async remove(bucket: string, path: string) {
    stored.delete(`${bucket}/${path}`);
  },
  async download(bucket: string, path: string) {
    const data = stored.get(`${bucket}/${path}`);
    if (!data) throw new Error("FILE_NOT_FOUND");
    return data;
  },
  publicUrl(bucket: string, path: string) {
    return `https://storage.example.invalid/${bucket}/${path}`;
  },
};
export const db = (await import("../src/server/db")).pool;
export const route = await import("../src/app/api/[...path]/route");
export type Client = { cookie: string; csrf: string };
export async function request(
  client: Client | null,
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
) {
  const multipart = data instanceof FormData;
  const req = new NextRequest("http://localhost:3000/api/" + path, {
    method,
    headers: {
      ...(client ? { Cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(method !== "GET" ? { Origin: "http://localhost:3000" } : {}),
      ...(!multipart && data !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    body:
      data === undefined
        ? undefined
        : multipart
          ? data
          : typeof data === "string"
            ? data
            : JSON.stringify(data),
  });
  const fn = route[method as keyof typeof route] as typeof route.GET;
  const res = await fn(req, {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  });
  return res;
}
export async function client(): Promise<Client> {
  const r = await request(null, "session");
  const d = await r.json();
  return { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: d.csrf };
}
export async function customerClient(email = `${randomUUID()}@example.invalid`) {
  const c = await client();
  const account = (
    await db.query(
      `INSERT INTO customer_accounts(name,first_name,last_name,email,mobile,password_hash)
       VALUES('Test Customer','Test','Customer',$1,'01000000000',$2) RETURNING id`,
      [email, await bcrypt.hash(`Fixture9${randomBytes(8).toString("hex")}`, 4)],
    )
  ).rows[0];
  const raw = c.cookie.slice(c.cookie.indexOf("=") + 1);
  await db.query("UPDATE sessions SET customer_account_id=$1 WHERE token_hash=$2", [
    account.id,
    createHash("sha256").update(raw).digest("hex"),
  ]);
  return c;
}
export async function clearRates() {
  await db.query("DELETE FROM rate_limits");
}
export async function auth(email: string, password: string) {
  const c = await client();
  const r = await request(c, "auth/login", "POST", { email, password });
  if (!r.ok) throw new Error("Fixture auth failure " + (await r.text()));
  c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await r.json()).csrf;
  const statusResponse = await request(c, "auth/mfa");
  const status = await statusResponse.json();
  if (status.challenge === "enroll") {
    const setupResponse = await request(c, "auth/mfa/setup");
    const setup = await setupResponse.json();
    const { totpCode } = await import("../src/server/totp");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const letter of setup.manualKey) {
      value = (value << 5) | alphabet.indexOf(letter);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((value >>> bits) & 255);
      }
    }
    const enrolled = await request(c, "auth/mfa/enroll", "POST", {
      code: totpCode(Buffer.from(bytes), Math.floor(Date.now() / 30_000)),
    });
    if (!enrolled.ok) throw new Error("Fixture MFA enrollment failure " + (await enrolled.text()));
    c.cookie = enrolled.headers.get("set-cookie")!.split(";")[0];
    const enrolledData = await enrolled.json();
    c.csrf = enrolledData.csrf;
  } else {
    const row = (
      await db.query(
        "SELECT id,totp_ciphertext,totp_last_counter FROM admin_users WHERE email=$1",
        [email],
      )
    ).rows[0];
    const { decryptMfa, totpCode } = await import("../src/server/totp");
    // Move only the fixture clock to a fresh TOTP interval; replay protection stays active.
    const counter = Math.max(Math.floor(Date.now() / 30_000), Number(row.totp_last_counter) + 1);
    const clock = mock.method(Date, "now", () => counter * 30_000);
    let verified: Response;
    try {
      verified = await request(c, "auth/mfa/verify", "POST", {
        code: totpCode(decryptMfa(row.totp_ciphertext, row.id), counter),
      });
    } finally {
      clock.mock.restore();
    }
    if (!verified.ok) throw new Error("Fixture MFA verification failure " + (await verified.text()));
    c.cookie = verified.headers.get("set-cookie")!.split(";")[0];
    c.csrf = (await verified.json()).csrf;
  }
  return c;
}
