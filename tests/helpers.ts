import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { NextRequest } from "next/server";
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: randomBytes(32).toString("hex"),
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
export async function clearRates() {
  await db.query("DELETE FROM rate_limits");
}
export async function auth(email: string, password: string) {
  const c = await client();
  const r = await request(c, "auth/login", "POST", { email, password });
  if (!r.ok) throw new Error("Fixture auth failure " + (await r.text()));
  c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await r.json()).csrf;
  return c;
}
