import { after, test } from "node:test";
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

const { proxy } = await import("../src/proxy");

after(async () => engine.close());

test("password login directly issues a rotated authorized session without an MFA key or challenge", async () => {
  delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
  const email = "password-owner@example.invalid";
  const password = `Strong9${randomBytes(12).toString("hex")}`;
  await db.query(
    "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
    [email, await bcrypt.hash(password, 14)],
  );
  const c = await client();
  const original = { ...c };
  const response = await request(c, "auth/login", "POST", { email, password });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["csrf", "ok"]);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  c.cookie = cookie.split(";")[0];
  c.csrf = data.csrf;
  assert.notEqual(c.cookie, original.cookie);
  assert.equal((await request(c, "admin/dashboard")).status, 200);
  assert.equal((await request(original, "admin/dashboard")).status, 401);
  assert.equal(
    (await request(await customerClient(), "admin/dashboard")).status,
    401,
  );
  assert.equal((await request(null, "admin/dashboard")).status, 401);
  const created = await request(c, "admin/users", "POST", {
    email: "bcrypt14-admin@example.invalid",
    password: "NewAdminPassword9!",
    role: "support",
  });
  assert.equal(created.status, 200);
  const id = (await created.json()).id;
  assert.equal(
    bcrypt.getRounds(
      (
        await db.query("SELECT password_hash FROM admin_users WHERE id=$1", [
          id,
        ])
      ).rows[0].password_hash,
    ),
    14,
  );
  for (const actor of [null, await client(), await customerClient(), c])
    for (const endpoint of [
      "auth/mfa",
      "auth/mfa/setup",
      "auth/mfa/enroll",
      "auth/mfa/verify",
      "auth/mfa/recovery",
    ])
      for (const method of ["GET", "POST"])
        assert.equal(
          (
            await request(
              actor,
              endpoint,
              method,
              method === "POST" ? { code: "123456" } : undefined,
            )
          ).status,
          404,
        );
  const second = await client();
  const secondLogin = await request(second, "auth/login", "POST", {
    email,
    password,
  });
  second.cookie = secondLogin.headers.get("set-cookie")!.split(";")[0];
  second.csrf = (await secondLogin.json()).csrf;
  assert.equal((await request(c, "admin/dashboard")).status, 200);
  assert.equal((await request(second, "admin/dashboard")).status, 200);
  assert.equal((await request(c, "auth/logout", "POST", {})).status, 200);
  assert.equal((await request(c, "admin/dashboard")).status, 401);
  assert.equal((await request(second, "admin/dashboard")).status, 200);
  await db.query(
    "UPDATE sessions SET last_seen_at=now()-interval '31 minutes' WHERE admin_id=(SELECT id FROM admin_users WHERE email=$1)",
    [email],
  );
  assert.equal((await request(second, "admin/dashboard")).status, 401);
  await clearRates();
  const bad = await client();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(bad, "auth/login", "POST", {
          email,
          password: "incorrect",
        })
      ).status,
      401,
    );
  assert.equal(
    (await request(bad, "auth/login", "POST", { email, password: "incorrect" }))
      .status,
    429,
  );
});

test("old admin URL is a non-disclosing 404 and sensitive routes are noindex/no-store", async () => {
  const old = await proxy(new NextRequest("http://localhost:3000/admin"));
  assert.equal(old.status, 404);
  assert.equal(old.headers.get("location"), null);
  assert.equal(old.headers.get("x-content-type-options"), "nosniff");

  const account = await proxy(
    new NextRequest("http://localhost:3000/account/orders"),
  );
  assert.equal(account.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(account.headers.get("cache-control"), "private, no-store");
  assert.match(
    account.headers.get("content-security-policy") || "",
    /frame-ancestors 'none'/,
  );
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
  await db.query("INSERT INTO inventory(product_id,stock) VALUES($1,5)", [
    product.id,
  ]);
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
    (
      await request(customer, "cart", "POST", {
        productId: product.id,
        quantity: 1,
      })
    ).status,
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

test("migration 010 removes retired MFA storage without changing accounts, sessions or history", async () => {
  const upgrade = new PGlite();
  try {
    for (const file of (await readdir("migrations"))
      .filter((x) => x.endsWith(".sql") && x < "010")
      .sort())
      await upgrade.exec(await readFile("migrations/" + file, "utf8"));
    const id = randomUUID(),
      customer = randomUUID();
    await upgrade.query(
      "INSERT INTO admin_users(id,email,password_hash,role_id,totp_ciphertext,totp_enabled) VALUES($1,'upgrade@example.invalid','unchanged-password-hash','owner','encrypted-historical-fixture',true)",
      [id],
    );
    await upgrade.query(
      "INSERT INTO audit_logs(actor_id,action,entity) VALUES($1,'historical','admin_users')",
      [id],
    );
    await upgrade.query(
      "INSERT INTO customer_accounts(id,email,name,password_hash) VALUES($1,'customer@example.invalid','Customer','unchanged-customer-password')",
      [customer],
    );
    const full = (
      await upgrade.query<{ id: string }>(
        "INSERT INTO sessions(token_hash,csrf_hash,admin_id,mfa_verified_at,expires_at) VALUES('full-fixture','csrf',$1,now(),now()+interval '1 hour') RETURNING id",
        [id],
      )
    ).rows[0].id;
    const pending = (
      await upgrade.query<{ id: string }>(
        "INSERT INTO sessions(token_hash,csrf_hash,pending_admin_id,enrollment_ciphertext,expires_at) VALUES('pending-fixture','csrf',$1,'enrollment-fixture',now()+interval '5 minutes') RETURNING id",
        [id],
      )
    ).rows[0].id;
    const customerSession = (
      await upgrade.query<{ id: string }>(
        "INSERT INTO sessions(token_hash,csrf_hash,customer_account_id,expires_at) VALUES('customer-fixture','csrf',$1,now()+interval '1 day') RETURNING id",
        [customer],
      )
    ).rows[0].id;
    const before = (await upgrade.query("SELECT * FROM audit_logs")).rows;
    await upgrade.exec(
      await readFile("migrations/010_remove_admin_totp_mfa.sql", "utf8"),
    );
    assert.deepEqual(
      (await upgrade.query("SELECT * FROM audit_logs")).rows,
      before,
    );
    assert.deepEqual(
      (
        await upgrade.query(
          "SELECT email,password_hash,role_id,active FROM admin_users WHERE id=$1",
          [id],
        )
      ).rows,
      [
        {
          email: "upgrade@example.invalid",
          password_hash: "unchanged-password-hash",
          role_id: "owner",
          active: true,
        },
      ],
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT id FROM sessions WHERE id=$1 AND admin_id=$2 AND expires_at>now()",
          [full, id],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT id FROM sessions WHERE id=$1 AND expires_at<=now() AND admin_id IS NULL",
          [pending],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT id FROM sessions WHERE id=$1 AND customer_account_id=$2 AND expires_at>now()",
          [customerSession, customer],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name IN ('admin_users','sessions') AND (column_name LIKE '%totp%' OR column_name LIKE '%mfa%' OR column_name IN ('pending_admin_id','enrollment_ciphertext','recovery_hashes'))",
        )
      ).rows.length,
      0,
    );
    await upgrade.query("DELETE FROM admin_users WHERE id=$1", [id]);
    assert.equal(
      (
        await upgrade.query(
          "SELECT id FROM sessions WHERE id=$1 AND admin_id IS NULL AND expires_at<=now()",
          [full],
        )
      ).rows.length,
      1,
    );
    assert.deepEqual(
      (await upgrade.query("SELECT * FROM audit_logs")).rows,
      before,
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT id FROM admin_identities WHERE id=$1 AND deleted_at IS NOT NULL",
          [id],
        )
      ).rows.length,
      1,
    );
  } finally {
    await upgrade.close();
  }
});

test("grants selects the direct migration connection before loading the database module", async () => {
  const source = await readFile("scripts/grants.ts", "utf8");
  assert.match(source, /export \{\};/);
  assert.match(
    source,
    /if \(process.env.DIRECT_DATABASE_URL\) \{\s*process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;/,
  );
  assert.ok(
    source.indexOf("process.env.DATABASE_URL =") <
      source.indexOf('await import("../src/server/db")'),
  );
  assert.doesNotMatch(source, /^import .*from ["'].*server\/db/m);
});

test("account management retains recent password authentication and absolute session expiry", async () => {
  await clearRates();
  const email = "recent-admin@example.invalid",
    password = "RecentPasswordFixture9!";
  await db.query(
    "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
    [email, await bcrypt.hash(password, 4)],
  );
  const c = await client();
  const response = await request(c, "auth/login", "POST", { email, password });
  c.cookie = response.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await response.json()).csrf;
  await db.query(
    "UPDATE sessions SET created_at=now()-interval '11 minutes' WHERE admin_id=(SELECT id FROM admin_users WHERE email=$1)",
    [email],
  );
  const denied = await request(c, "admin/users", "POST", {
    email: "denied@example.invalid",
    password: "StrongPasswordFixture9!",
    role: "support",
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "RECENT_AUTH_REQUIRED" });
  assert.equal((await request(c, "admin/dashboard")).status, 200);
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE admin_id=(SELECT id FROM admin_users WHERE email=$1)",
    [email],
  );
  assert.equal((await request(c, "admin/dashboard")).status, 401);
});
