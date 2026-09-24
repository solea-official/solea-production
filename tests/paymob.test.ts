import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  auth,
  clearRates,
  client,
  db,
  engine,
  request,
  type Client,
} from "./helpers";

const secret = randomBytes(32).toString("hex");
const password = `Aa9${randomBytes(14).toString("hex")}`;
const integrationId = 456789;
let owner: Client;
let productId = "";
let providerSequence = 777000;
let lastIntention: Record<string, unknown> | null = null;
const originalFetch = globalThis.fetch;

const product = {
  sku: "PAYMOB-001",
  slug: "paymob-product",
  name_en: "SOLÉA Paymob Test",
  name_ar: "اختبار Paymob من SOLÉA",
  description_en: "Test",
  description_ar: "اختبار",
  volume: "125 mL",
  category_id: null,
  price: 10_000,
  stock: 20,
  status: "active",
  usage_en: "",
  usage_ar: "",
  warnings_en: "",
  warnings_ar: "",
  inci: "",
  seo_title: "",
  seo_description: "",
};

function checkoutData(extra: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    fullName: "Paymob Test Customer",
    mobile: "01000000000",
    email: "paymob-buyer@example.invalid",
    governorate: "Cairo",
    city: "Cairo",
    street: "Test Street",
    building: "1",
    floor: "2",
    apartment: "3",
    notes: "",
    payment: "paymob",
    transferReference: "",
    coupon: "",
    locale: "en",
    acceptTerms: true,
    ...extra,
  };
}

function callback(reference: string, providerOrderId: string, success = true) {
  return {
    type: "TRANSACTION" as const,
    obj: {
      id: providerSequence + 10_000,
      pending: false,
      amount_cents: 11_500,
      success,
      is_auth: false,
      is_capture: true,
      is_standalone_payment: true,
      is_voided: false,
      is_refunded: false,
      is_3d_secure: true,
      integration_id: integrationId,
      has_parent_transaction: false,
      created_at: "2026-09-24T12:00:00Z",
      currency: "EGP" as const,
      error_occured: !success,
      owner: 42,
      source_data: { pan: "1234", sub_type: "MasterCard", type: "card" },
      order: { id: providerOrderId, merchant_order_id: reference },
    },
  };
}

function callbackHmac(data: ReturnType<typeof callback>) {
  const o = data.obj;
  const values = [
    o.amount_cents,
    o.created_at,
    o.currency,
    o.error_occured,
    o.has_parent_transaction,
    o.id,
    o.integration_id,
    o.is_3d_secure,
    o.is_auth,
    o.is_capture,
    o.is_refunded,
    o.is_standalone_payment,
    o.is_voided,
    o.order.id,
    o.owner,
    o.pending,
    o.source_data.pan,
    o.source_data.sub_type,
    o.source_data.type,
    o.success,
  ]
    .map((value) =>
      typeof value === "boolean" ? String(value).toLowerCase() : String(value),
    )
    .join("");
  return createHmac("sha512", secret).update(values).digest("hex");
}

async function createPaymobOrder() {
  const customer = await client();
  assert.equal(
    (await request(customer, "cart", "POST", { productId, quantity: 1 }))
      .status,
    200,
  );
  const response = await request(customer, "checkout", "POST", checkoutData());
  if (response.status !== 201)
    assert.fail(
      `Paymob checkout failed: ${response.status} ${await response.text()}`,
    );
  return { customer, ...(await response.json()) } as Client & {
    customer: Client;
    id: string;
    reference: string;
    checkoutUrl: string;
  };
}

before(async () => {
  Object.assign(process.env, {
    PAYMOB_ENABLED: "true",
    PAYMOB_SECRET_KEY: "sk_test_server_only",
    PAYMOB_PUBLIC_KEY: "pk_test_public",
    PAYMOB_HMAC_SECRET: secret,
    PAYMOB_INTEGRATION_IDS: String(integrationId),
    CRON_SECRET: randomBytes(32).toString("hex"),
  });
  globalThis.fetch = async (_input, init) => {
    lastIntention = JSON.parse(String(init?.body));
    providerSequence += 1;
    return Response.json({
      id: `intent-${providerSequence}`,
      intention_order_id: providerSequence,
      client_secret: `client-secret-${providerSequence}-safe-placeholder`,
    });
  };
  await db.query(
    "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
    ["paymob-owner@example.invalid", await bcrypt.hash(password, 4)],
  );
  owner = await auth("paymob-owner@example.invalid", password);
  const created = await request(owner, "admin/products", "POST", product);
  assert.equal(created.status, 200);
  productId = (await created.json()).id;
  await db.query(
    `UPDATE store_settings SET enabled=true,cod_enabled=true,
     shipping_zones='[{"governorate":"Cairo","zone":"Greater Cairo","fee":1500,"active":true}]'`,
  );
  for (const key of ["terms", "privacy", "returns", "shipping-policy"])
    await db.query(
      "INSERT INTO content(key,published) VALUES($1,true) ON CONFLICT(key) DO UPDATE SET published=true",
      [key],
    );
});

after(async () => {
  globalThis.fetch = originalFetch;
  await engine.close();
});

test("Paymob remains disabled until complete server configuration exists", async () => {
  const { paymobSettings } = await import("../src/server/paymob");
  const original = process.env.PAYMOB_HMAC_SECRET;
  delete process.env.PAYMOB_HMAC_SECRET;
  assert.equal(paymobSettings().enabled, false);
  process.env.PAYMOB_HMAC_SECRET = original;
  assert.equal(paymobSettings().enabled, true);
});

test("successful admin login does not remain in the failed-account counter", async () => {
  const { hash } = await import("../src/server/security");
  const key = hash("login-account:direct:paymob-owner@example.invalid");
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM rate_limits WHERE key=$1", [
        key,
      ])
    ).rows[0].n,
    0,
  );
});

test("admin failed-login throttling stays generic and valid multi-device sessions coexist", async () => {
  await clearRates();
  const attacker = await client();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request(attacker, "auth/login", "POST", {
      email: "missing-admin@example.invalid",
      password: "incorrect",
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "INVALID_LOGIN");
  }
  assert.equal(
    (
      await request(attacker, "auth/login", "POST", {
        email: "missing-admin@example.invalid",
        password: "incorrect",
      })
    ).status,
    429,
  );
  await clearRates();
  const secondDevice = await auth("paymob-owner@example.invalid", password);
  assert.equal((await request(owner, "admin/products")).status, 200);
  assert.equal((await request(secondDevice, "admin/products")).status, 200);
});

test("public product payload excludes internal ingredient data", async () => {
  const response = await request(null, "products");
  assert.equal(response.status, 200);
  const rows = (await response.json()) as Record<string, unknown>[];
  assert.equal(Object.hasOwn(rows[0], "inci"), false);
  const internal = await request(owner, `admin/products/${productId}`);
  assert.equal(internal.status, 200);
  assert.equal(Object.hasOwn((await internal.json()) as object, "inci"), true);
});

test("checkout creates a hosted intention from database-authoritative totals", async () => {
  const tampered = await client();
  await request(tampered, "cart", "POST", { productId, quantity: 1 });
  assert.equal(
    (await request(tampered, "checkout", "POST", checkoutData({ total: 1 })))
      .status,
    400,
  );

  const order = await createPaymobOrder();
  assert.match(
    order.checkoutUrl,
    /^https:\/\/accept\.paymob\.com\/unifiedcheckout\//,
  );
  assert.equal(lastIntention?.amount, 11_500);
  assert.equal(lastIntention?.currency, "EGP");
  assert.equal(lastIntention?.special_reference, order.reference);
  assert.deepEqual(lastIntention?.payment_methods, [integrationId]);
  const row = (
    await db.query(
      `SELECT o.total,o.payment_method,p.status,p.amount,p.provider_id,p.provider_order_id
       FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1`,
      [order.id],
    )
  ).rows[0];
  assert.equal(row.total, 11_500);
  assert.equal(row.amount, 11_500);
  assert.equal(row.payment_method, "paymob");
  assert.equal(row.status, "pending");
  assert.ok(row.provider_id);
  assert.ok(row.provider_order_id);
});

test("customer cannot submit or confirm Paymob status", async () => {
  const order = await createPaymobOrder();
  assert.equal(
    (
      await request(order.customer, "payment-submission", "POST", {
        orderId: order.id,
        reference: "FORGED",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        order.customer,
        `admin/orders/${order.id}/confirm-payment`,
        "POST",
        {},
      )
    ).status,
    401,
  );
});

test("callback rejects forged or mismatched events and accepts a valid event once", async () => {
  const order = await createPaymobOrder();
  const payment = (
    await db.query("SELECT provider_order_id FROM payments WHERE order_id=$1", [
      order.id,
    ])
  ).rows[0];
  const event = callback(order.reference, payment.provider_order_id);
  assert.equal(
    (
      await request(
        null,
        `webhooks/paymob?hmac=${"0".repeat(128)}`,
        "POST",
        event,
      )
    ).status,
    401,
  );
  const altered = structuredClone(event);
  altered.obj.amount_cents = 1;
  assert.equal(
    (
      await request(
        null,
        `webhooks/paymob?hmac=${callbackHmac(altered)}`,
        "POST",
        altered,
      )
    ).status,
    409,
  );
  const signature = callbackHmac(event);
  const first = await request(
    null,
    `webhooks/paymob?hmac=${signature}`,
    "POST",
    event,
  );
  assert.equal(first.status, 200, await first.text());
  const duplicate = await request(
    null,
    `webhooks/paymob?hmac=${signature}`,
    "POST",
    event,
  );
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  const status = (
    await db.query(
      "SELECT o.status,p.status payment_status,p.provider_transaction_id FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1",
      [order.id],
    )
  ).rows[0];
  assert.equal(status.status, "paid");
  assert.equal(status.payment_status, "paid");
  assert.equal(status.provider_transaction_id, String(event.obj.id));
  const auditCount = (
    await db.query(
      "SELECT count(*)::int n FROM audit_logs WHERE action='webhook.paymob' AND entity_id=$1",
      [order.id],
    )
  ).rows[0].n;
  assert.equal(auditCount, 1);
});

test("failed callback cancels once and restores reserved stock once", async () => {
  const beforeStock = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  const order = await createPaymobOrder();
  const providerOrderId = (
    await db.query("SELECT provider_order_id FROM payments WHERE order_id=$1", [
      order.id,
    ])
  ).rows[0].provider_order_id;
  const event = callback(order.reference, providerOrderId, false);
  const signature = callbackHmac(event);
  assert.equal(
    (await request(null, `webhooks/paymob?hmac=${signature}`, "POST", event))
      .status,
    200,
  );
  assert.equal(
    (await request(null, `webhooks/paymob?hmac=${signature}`, "POST", event))
      .status,
    200,
  );
  const current = (
    await db.query(
      "SELECT o.status,o.stock_released,p.status payment_status,i.stock FROM orders o JOIN payments p ON p.order_id=o.id JOIN inventory i ON i.product_id=$2 WHERE o.id=$1",
      [order.id, productId],
    )
  ).rows[0];
  assert.equal(current.status, "cancelled");
  assert.equal(current.payment_status, "failed");
  assert.equal(current.stock_released, true);
  assert.equal(current.stock, beforeStock);
});

test("serverless maintenance endpoint is secret-protected and expires reservations once", async () => {
  const beforeStock = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  const order = await createPaymobOrder();
  await db.query(
    "UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [order.id],
  );
  assert.equal((await request(null, "internal/maintenance")).status, 401);
  const response = await request(
    null,
    "internal/maintenance",
    "GET",
    undefined,
    {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).expired, 1);
  const current = (
    await db.query(
      "SELECT o.status,o.stock_released,p.status payment_status,i.stock FROM orders o JOIN payments p ON p.order_id=o.id JOIN inventory i ON i.product_id=$2 WHERE o.id=$1",
      [order.id, productId],
    )
  ).rows[0];
  assert.equal(current.status, "cancelled");
  assert.equal(current.payment_status, "failed");
  assert.equal(current.stock_released, true);
  assert.equal(current.stock, beforeStock);
  const second = await request(null, "internal/maintenance", "GET", undefined, {
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  });
  assert.equal((await second.json()).expired, 0);
});
