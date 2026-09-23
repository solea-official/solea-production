import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { auth, clearRates, client, db, engine, request, type Client } from "./helpers";
const { createCustomerReset, resetCustomerPassword } = await import("../src/server/customer-auth");

const adminPassword = "Adm9" + randomBytes(14).toString("hex");
const passwordA = "CustomerA9!" + randomBytes(6).toString("hex");
const passwordB = "CustomerB9!" + randomBytes(6).toString("hex");
const changedPassword = "ChangedA9!" + randomBytes(6).toString("hex");
let admin: Client;
let accountA: Client;
let accountB: Client;
let accountAId = "";
let productId = "";
let guestOrder: { id: string; reference: string; trackingToken: string };

const address = {
  label: "Home",
  full_name: "Account Customer",
  mobile: "01000000000",
  governorate: "Cairo",
  city: "Cairo",
  street: "SOLÉA Test Street",
  building: "1",
  floor: "2",
  apartment: "3",
  notes: "",
  is_default: true,
};

const checkout = (payment: "cod" | "instapay" = "cod") => ({
  idempotencyKey: randomUUID(),
  fullName: address.full_name,
  mobile: address.mobile,
  email: "submitted-email@example.invalid",
  governorate: address.governorate,
  city: address.city,
  street: address.street,
  building: address.building,
  floor: address.floor,
  apartment: address.apartment,
  notes: "",
  payment,
  transferReference: "",
  savedAddressId: null,
  saveAddress: false,
  coupon: "",
  locale: "en" as const,
  acceptTerms: true as const,
});

function adopt(target: Client, response: Response, body: { csrf: string }) {
  target.cookie = response.headers.get("set-cookie")!.split(";")[0];
  target.csrf = body.csrf;
}

async function register(email: string, password: string, name: string) {
  const c = await client();
  const response = await request(c, "account/register", "POST", {
    name,
    email,
    password,
    mobile: "",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  adopt(c, response, body);
  return { client: c, account: body.account as { id: string } };
}

before(async () => {
  await db.query(
    "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
    ["account-owner@example.invalid", await bcrypt.hash(adminPassword, 4)],
  );
  admin = await auth("account-owner@example.invalid", adminPassword);
  const response = await request(admin, "admin/products", "POST", {
    sku: "ACCOUNT-001",
    slug: "account-product",
    name_en: "SOLÉA Account Test",
    name_ar: "اختبار حساب SOLÉA",
    description_en: "Test",
    description_ar: "اختبار",
    volume: "125 mL",
    category_id: null,
    price: 10_000,
    stock: 30,
    status: "active",
    usage_en: "",
    usage_ar: "",
    warnings_en: "",
    warnings_ar: "",
    inci: "Aqua",
    seo_title: "",
    seo_description: "",
  });
  assert.equal(response.status, 200);
  productId = (await response.json()).id;
  await db.query(
    `UPDATE store_settings SET enabled=true,cod_enabled=true,
     shipping_zones='[{"governorate":"Cairo","zone":"","fee":1500,"active":true}]'`,
  );
  for (const key of ["terms", "privacy", "returns", "shipping-policy"])
    await db.query(
      "INSERT INTO content(key,published) VALUES($1,true) ON CONFLICT(key) DO UPDATE SET published=true",
      [key],
    );
});

after(async () => engine.close());

test("customer registration hashes at cost 14, rotates session, and rejects duplicates", async () => {
  const initial = await client();
  const originalCookie = initial.cookie;
  const response = await request(initial, "account/register", "POST", {
    name: "Customer A",
    email: "customer-a@example.invalid",
    password: passwordA,
    mobile: "01000000000",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  adopt(initial, response, body);
  accountA = initial;
  accountAId = body.account.id;
  assert.notEqual(accountA.cookie, originalCookie);
  const row = (
    await db.query("SELECT password_hash FROM customer_accounts WHERE id=$1", [accountAId])
  ).rows[0];
  assert.equal(bcrypt.getRounds(row.password_hash), 14);
  assert.equal(await bcrypt.compare(passwordA, row.password_hash), true);
  assert.equal((await request({ ...accountA, cookie: originalCookie }, "account/me")).status, 401);

  const duplicate = await client();
  assert.equal(
    (
      await request(duplicate, "account/register", "POST", {
        name: "Duplicate",
        email: "customer-a@example.invalid",
        password: passwordA,
        mobile: "",
      })
    ).status,
    409,
  );
});

test("invalid login is generic; logout and password change invalidate sessions", async () => {
  await clearRates();
  const invalid = await client();
  const missing = await request(invalid, "account/login", "POST", {
    email: "missing@example.invalid",
    password: "WrongPassword9!",
  });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "INVALID_CUSTOMER_LOGIN" });

  const second = await client();
  const login = await request(second, "account/login", "POST", {
    email: "customer-a@example.invalid",
    password: passwordA,
  });
  assert.equal(login.status, 200);
  adopt(second, login, await login.json());
  const oldSecond = { ...second };

  const changed = await request(accountA, "account/change-password", "POST", {
    currentPassword: passwordA,
    newPassword: changedPassword,
  });
  assert.equal(changed.status, 200);
  adopt(accountA, changed, await changed.json());
  assert.equal((await request(oldSecond, "account/me")).status, 401);

  await clearRates();
  const oldPassword = await client();
  assert.equal(
    (
      await request(oldPassword, "account/login", "POST", {
        email: "customer-a@example.invalid",
        password: passwordA,
      })
    ).status,
    401,
  );
  const fresh = await client();
  const relogin = await request(fresh, "account/login", "POST", {
    email: "customer-a@example.invalid",
    password: changedPassword,
  });
  assert.equal(relogin.status, 200);
  adopt(fresh, relogin, await relogin.json());
  accountA = fresh;

  const logoutCookie = accountA.cookie;
  const logout = await request(accountA, "account/logout", "POST", {});
  assert.equal(logout.status, 200);
  adopt(accountA, logout, await logout.json());
  assert.equal((await request({ ...accountA, cookie: logoutCookie }, "account/me")).status, 401);
  const loggedOut = await request(accountA, "account/me");
  assert.equal(loggedOut.status, 401);

  const back = await request(accountA, "account/login", "POST", {
    email: "customer-a@example.invalid",
    password: changedPassword,
  });
  adopt(accountA, back, await back.json());
});

test("saved address CRUD enforces account ownership", async () => {
  const b = await register("customer-b@example.invalid", passwordB, "Customer B");
  accountB = b.client;
  const created = await request(accountA, "account/addresses", "POST", address);
  assert.equal(created.status, 200);
  const addressId = (await created.json()).id;
  assert.equal((await request(accountB, `account/addresses/${addressId}`, "PUT", address)).status, 404);
  assert.equal((await request(accountB, `account/addresses/${addressId}`, "DELETE")).status, 404);
  assert.equal(
    (await request(accountB, "account/addresses").then((r) => r.json())).length,
    0,
  );
  assert.equal((await request(accountA, `account/addresses/${addressId}`, "PUT", { ...address, city: "Giza" })).status, 200);
});

test("guest and authenticated checkout coexist with explicit order ownership", async () => {
  const guest = await client();
  assert.equal((await request(guest, "cart", "POST", { productId, quantity: 1 })).status, 200);
  const guestCheckout = await request(guest, "checkout", "POST", checkout());
  assert.equal(guestCheckout.status, 201);
  guestOrder = await guestCheckout.json();
  assert.equal(
    (await db.query("SELECT account_id FROM orders WHERE id=$1", [guestOrder.id])).rows[0].account_id,
    null,
  );

  assert.equal((await request(accountA, "cart", "POST", { productId, quantity: 2 })).status, 200);
  const accountCheckout = await request(accountA, "checkout", "POST", checkout("instapay"));
  assert.equal(accountCheckout.status, 201);
  const owned = await accountCheckout.json();
  const order = (
    await db.query(
      "SELECT o.account_id,c.email,o.total FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1",
      [owned.id],
    )
  ).rows[0];
  assert.equal(order.account_id, accountAId);
  assert.equal(order.email, "customer-a@example.invalid");
  assert.equal(order.total, 21_500);
  const history = await request(accountA, "account/orders");
  assert.equal(history.status, 200);
  assert.equal((await history.json()).some((x: { id: string }) => x.id === owned.id), true);
  assert.equal((await request(accountA, `account/orders/${owned.id}`)).status, 200);
  assert.equal((await request(accountB, `account/orders/${owned.id}`)).status, 404);
  assert.equal((await request(accountB, `order?id=${owned.id}`)).status, 404);
});

test("guest order claiming requires the private key and cannot transfer ownership", async () => {
  assert.equal(
    (
      await request(accountA, "account/claim", "POST", {
        reference: guestOrder.reference,
        trackingKey: "0".repeat(64),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(accountA, "account/claim", "POST", {
        reference: guestOrder.reference,
        trackingKey: guestOrder.trackingToken,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(accountA, "account/claim", "POST", {
        reference: guestOrder.reference,
        trackingKey: guestOrder.trackingToken,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(accountB, "account/claim", "POST", {
        reference: guestOrder.reference,
        trackingKey: guestOrder.trackingToken,
      })
    ).status,
    409,
  );
  assert.equal(
    Number((await db.query("SELECT count(*) n FROM audit_logs WHERE action='order.claimed' AND entity_id=$1", [guestOrder.id])).rows[0].n),
    1,
  );
});

test("customer and admin identities remain separated", async () => {
  assert.equal((await request(accountA, "admin/dashboard")).status, 401);
  assert.equal((await request(admin, "account/me")).status, 401);
  const both = await db.query(
    "SELECT count(*)::int n FROM sessions WHERE admin_id IS NOT NULL AND customer_account_id IS NOT NULL",
  );
  assert.equal(both.rows[0].n, 0);
});

test("customer reset tokens are hashed, expiring, and single-use", async () => {
  const password = "ResetSource9!" + randomBytes(6).toString("hex");
  const nextPassword = "ResetTarget9!" + randomBytes(6).toString("hex");
  await register("reset-customer@example.invalid", password, "Reset Customer");
  const reset = await createCustomerReset("reset-customer@example.invalid");
  assert.ok(reset);
  const stored = (
    await db.query(
      "SELECT token_hash,expires_at,used_at FROM customer_password_resets WHERE account_id=$1",
      [reset.account.id],
    )
  ).rows[0];
  assert.notEqual(stored.token_hash, reset.raw);
  assert.equal(stored.used_at, null);
  assert.ok(new Date(stored.expires_at).getTime() > Date.now());
  assert.deepEqual(await resetCustomerPassword(reset.raw, nextPassword), { ok: true });
  await assert.rejects(() => resetCustomerPassword(reset.raw, nextPassword));
  const loginClient = await client();
  const login = await request(loginClient, "account/login", "POST", {
    email: "reset-customer@example.invalid",
    password: nextPassword,
  });
  assert.equal(login.status, 200);
});
