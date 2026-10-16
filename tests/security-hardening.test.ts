import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import {
  clearRates,
  client,
  customerClient,
  db,
  engine,
  request,
} from "./helpers";
import { decryptMfa, encryptMfa, totpCode } from "../src/server/totp";

const { proxy } = await import("../src/proxy");

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const letter of value) {
    buffer = (buffer << 5) | alphabet.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

after(async () => engine.close());

test("password-only admin session is pending until mandatory TOTP succeeds", async () => {
  const email = "mfa-owner@example.invalid";
  const password = `Strong9${randomBytes(12).toString("hex")}`;
  await db.query(
    "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
    [email, await bcrypt.hash(password, 4)],
  );
  const c = await client();
  const passwordStep = await request(c, "auth/login", "POST", { email, password });
  assert.equal(passwordStep.status, 200);
  c.cookie = passwordStep.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await passwordStep.json()).csrf;
  assert.equal((await request(c, "admin/dashboard")).status, 401);

  assert.deepEqual(await (await request(c, "auth/mfa")).json(), { challenge: "enroll" });
  const setup = await (await request(c, "auth/mfa/setup")).json();
  assert.match(setup.qr, /^data:image\/png;base64,/);
  const code = totpCode(
    decodeBase32(setup.manualKey),
    Math.floor(Date.now() / 30_000),
  );
  const invalidCode = code === "000000" ? "000001" : "000000";
  assert.equal(
    (await request(c, "auth/mfa/enroll", "POST", { code: invalidCode })).status,
    401,
  );
  await clearRates();
  const enrolled = await request(c, "auth/mfa/enroll", "POST", { code });
  assert.equal(enrolled.status, 200);
  const enrolledBody = await enrolled.json();
  assert.deepEqual(Object.keys(enrolledBody).sort(), ["csrf", "ok"]);
  c.cookie = enrolled.headers.get("set-cookie")!.split(";")[0];
  c.csrf = enrolledBody.csrf;
  assert.equal((await request(c, "admin/dashboard")).status, 200);
  const createdAdmin = await request(c, "admin/users", "POST", {
    email: "bcrypt14-admin@example.invalid",
    password: "NewAdminPassword9!",
    role: "support",
  });
  assert.equal(createdAdmin.status, 200);
  const createdAdminId = (await createdAdmin.json()).id;
  assert.equal(
    bcrypt.getRounds(
      (
        await db.query("SELECT password_hash FROM admin_users WHERE id=$1", [
          createdAdminId,
        ])
      ).rows[0].password_hash,
    ),
    14,
  );

  const logout = await request(c, "auth/logout", "POST", {});
  c.cookie = logout.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await logout.json()).csrf;
  const secondPassword = await request(c, "auth/login", "POST", { email, password });
  c.cookie = secondPassword.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await secondPassword.json()).csrf;
  assert.equal((await request(c, "admin/dashboard")).status, 401);
  assert.equal(
    (await request(c, "auth/mfa/verify", "POST", { recoveryCode: "old-test-backup-code" })).status,
    400,
  );
  assert.equal(
    (await request(c, "auth/mfa/verify", "POST", { code, recoveryCode: "old-test-backup-code" })).status,
    400,
  );
  assert.equal((await request(c, "admin/dashboard")).status, 401);
  // Previously enrolled authenticator remains valid; accepted codes cannot be replayed.
  assert.equal((await request(c, "auth/mfa/verify", "POST", { code })).status, 401);
  const counter = Math.floor(Date.now() / 30_000) + 1;
  const clock = mock.method(Date, "now", () => counter * 30_000);
  let verified: Response;
  try {
    verified = await request(c, "auth/mfa/verify", "POST", {
      code: totpCode(decodeBase32(setup.manualKey), counter),
    });
  } finally {
    clock.mock.restore();
  }
  assert.equal(verified.status, 200);
  assert.deepEqual(Object.keys(await verified.clone().json()).sort(), ["csrf", "ok"]);
  c.cookie = verified.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await verified.json()).csrf;
  assert.equal((await request(c, "admin/dashboard")).status, 200);
  for (const actor of [null, await client(), await customerClient(), c]) {
    for (const method of ["GET", "POST"]) {
      assert.equal((await request(actor, "auth/mfa/recovery", method, method === "POST" ? {} : undefined)).status, 404);
    }
  }
  const logoutAgain = await request(c, "auth/logout", "POST", {});
  c.cookie = logoutAgain.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await logoutAgain.json()).csrf;
  const thirdPassword = await request(c, "auth/login", "POST", { email, password });
  c.cookie = thirdPassword.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await thirdPassword.json()).csrf;
  await clearRates();
  for (let attempt = 0; attempt < 5; attempt += 1)
    assert.equal(
      (await request(c, "auth/mfa/verify", "POST", { code: invalidCode })).status,
      401,
    );
  assert.equal(
    (await request(c, "auth/mfa/verify", "POST", { code: invalidCode })).status,
    429,
  );
});

test("old admin URL is a non-disclosing 404 and sensitive routes are noindex/no-store", async () => {
  const old = await proxy(new NextRequest("http://localhost:3000/admin"));
  assert.equal(old.status, 404);
  assert.equal(old.headers.get("location"), null);
  assert.equal(old.headers.get("x-content-type-options"), "nosniff");

  const account = await proxy(new NextRequest("http://localhost:3000/account/orders"));
  assert.equal(account.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(account.headers.get("cache-control"), "private, no-store");
  assert.match(account.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
});

test("incomplete customer profile cannot complete checkout", async () => {
  const product = (
    await db.query(
      `INSERT INTO products(sku,slug,name_en,name_ar,description_en,description_ar,volume,price,status)
       VALUES($1,$2,'Security Test','اختبار أمان','Test','اختبار','125 mL',10000,'active')
       RETURNING id`,
      [`HARDEN-${randomUUID()}`, `harden-${randomUUID()}`],
    )
  ).rows[0];
  await db.query("INSERT INTO inventory(product_id,stock) VALUES($1,5)", [product.id]);
  await db.query(
    `UPDATE store_settings SET enabled=true,cod_enabled=true,
     shipping_zones='[{"governorate":"Cairo","zone":"","fee":1500,"active":true}]'`,
  );
  for (const key of ["terms", "privacy", "returns", "shipping-policy"])
    await db.query(
      "INSERT INTO content(key,published) VALUES($1,true) ON CONFLICT(key) DO UPDATE SET published=true",
      [key],
    );
  const customer = await customerClient("incomplete-profile@example.invalid");
  await db.query(
    "UPDATE customer_accounts SET first_name='',last_name='' WHERE email=$1",
    ["incomplete-profile@example.invalid"],
  );
  assert.equal(
    (await request(customer, "cart", "POST", { productId: product.id, quantity: 1 })).status,
    200,
  );
  const response = await request(customer, "checkout", "POST", {
    idempotencyKey: randomUUID(),
    fullName: "Incomplete Customer",
    mobile: "01000000000",
    email: "incomplete-profile@example.invalid",
    governorate: "Cairo",
    city: "Cairo",
    street: "Test Street",
    building: "1",
    floor: "2",
    apartment: "3",
    notes: "",
    payment: "cod",
    transferReference: "",
    savedAddressId: null,
    saveAddress: false,
    coupon: "",
    locale: "en",
    acceptTerms: true,
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "PROFILE_INCOMPLETE" });
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) n FROM orders WHERE account_id=(SELECT id FROM customer_accounts WHERE email=$1)",
          ["incomplete-profile@example.invalid"],
        )
      ).rows[0].n,
    ),
    0,
  );
});

test("Vercel Hobby maintenance cron runs no more than once daily", async () => {
  const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.deepEqual(vercel.crons, [
    { path: "/api/internal/maintenance", schedule: "0 3 * * *" },
  ]);
});

test("migration 008 removes only backup storage and preserves existing encrypted TOTP", async () => {
  const upgrade = new PGlite();
  try {
    for (const file of (await readdir("migrations")).filter((x) => x.endsWith(".sql") && x < "008").sort())
      await upgrade.exec(await readFile("migrations/" + file, "utf8"));
    const id = randomUUID();
    const secret = randomBytes(20);
    const ciphertext = encryptMfa(secret, id);
    const counter = Math.floor(Date.now() / 30_000);
    await upgrade.query(
      "INSERT INTO admin_users(id,email,password_hash,role_id,totp_ciphertext,totp_enabled,totp_last_counter,recovery_hashes) VALUES($1,'upgrade@example.invalid','fixture','owner',$2,true,$3,$4)",
      [id, ciphertext, counter - 1, JSON.stringify([randomBytes(32).toString("hex")])],
    );
    await upgrade.exec(await readFile("migrations/008_remove_admin_mfa_recovery_codes.sql", "utf8"));
    const row = (await upgrade.query<{totp_ciphertext: string; totp_enabled: boolean; totp_last_counter: number}>(
      "SELECT totp_ciphertext,totp_enabled,totp_last_counter FROM admin_users WHERE id=$1", [id],
    )).rows[0];
    assert.equal(row.totp_ciphertext, ciphertext);
    assert.equal(row.totp_enabled, true);
    assert.equal(Number(row.totp_last_counter), counter - 1);
    assert.deepEqual(decryptMfa(row.totp_ciphertext, id), secret);
    const { verifyTotp } = await import("../src/server/totp");
    assert.equal(verifyTotp(decryptMfa(row.totp_ciphertext, id), totpCode(secret, counter), Number(row.totp_last_counter)), counter);
    assert.equal((await upgrade.query("SELECT column_name FROM information_schema.columns WHERE table_name='admin_users' AND column_name='recovery_hashes'")).rows.length, 0);
  } finally {
    await upgrade.close();
  }
});
