import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { totpCode } from "../src/server/totp";

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
  assert.equal(enrolledBody.recoveryCodes.length, 10);
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
  const recovery = enrolledBody.recoveryCodes[0];
  const recovered = await request(c, "auth/mfa/verify", "POST", { recoveryCode: recovery });
  assert.equal(recovered.status, 200);
  c.cookie = recovered.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await recovered.json()).csrf;

  const logoutAgain = await request(c, "auth/logout", "POST", {});
  c.cookie = logoutAgain.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await logoutAgain.json()).csrf;
  const thirdPassword = await request(c, "auth/login", "POST", { email, password });
  c.cookie = thirdPassword.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await thirdPassword.json()).csrf;
  assert.equal(
    (await request(c, "auth/mfa/verify", "POST", { recoveryCode: recovery })).status,
    401,
  );
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
