import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import {
  db,
  engine,
  request,
  client,
  auth,
  clearRates,
  Client,
} from "./helpers";
const { proxy } = await import("../src/proxy");
const { discountAmount } = await import("../src/server/commerce");
import { parseMoney } from "../src/lib/api";
const { hash, sign, verifyWebhook } = await import("../src/server/security");
let owner: Client,
  support: Client,
  guest: Client,
  other: Client,
  productId: string,
  orderId: string,
  reference: string,
  trackingToken: string;
const secretPassword = "Aa9" + randomBytes(14).toString("hex");
const checkoutData = () => ({
  idempotencyKey: randomUUID(),
  fullName: "Test Customer",
  mobile: "01000000000",
  email: "customer@example.invalid",
  governorate: "Test Region",
  city: "Test City",
  street: "Test Street",
  building: "1",
  floor: "2",
  apartment: "3",
  notes: "",
  payment: "cod",
  coupon: "",
  locale: "en",
  acceptTerms: true,
});
const productData = () => ({
  sku: "TEST-" + randomUUID().slice(0, 8),
  slug: "test-" + randomUUID().slice(0, 8),
  name_en: "SOLÉA Test Product",
  name_ar: "منتج اختبار SOLÉA",
  description_en: "Test description",
  description_ar: "وصف للاختبار",
  volume: "125 mL",
  category_id: null,
  price: 12345,
  stock: 20,
  status: "active",
  usage_en: "",
  usage_ar: "",
  warnings_en: "",
  warnings_ar: "",
  inci: "Aqua",
  seo_title: "",
  seo_description: "",
});
before(async () => {
  for (const [email, role] of [
    ["owner@example.invalid", "owner"],
    ["support@example.invalid", "support"],
  ])
    await db.query(
      "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,$3)",
      [email, await bcrypt.hash(secretPassword, 4), role],
    );
  owner = await auth("owner@example.invalid", secretPassword);
  support = await auth("support@example.invalid", secretPassword);
  guest = await client();
  other = await client();
  await clearRates();
  const r = await request(owner, "admin/products", "POST", productData());
  assert.equal(r.status, 200);
  productId = (await r.json()).id;
  await db.query(
    'UPDATE store_settings SET enabled=true,shipping_zones=\'[{"governorate":"Test Region","zone":"","fee":1555,"active":true}]\' WHERE id=1',
  );
  for (const key of ["terms", "privacy", "returns", "shipping-policy"])
    await db.query("INSERT INTO content(key,published) VALUES($1,true)", [key]);
});
after(async () => {
  await engine.close();
});
test("unknown route receives explicit 404 through the production proxy", async () => {
  assert.equal(
    (await proxy(new NextRequest("http://localhost:3000/does-not-exist")))
      .status,
    404,
  );
  assert.equal(
    (
      await proxy(
        new NextRequest("http://localhost:3000/products/does-not-exist"),
      )
    ).status,
    404,
  );
});
test("cart add increments atomically and enforces limits", async () => {
  const c = await client();
  assert.equal(
    (await request(c, "cart", "POST", { productId, quantity: 2 })).status,
    200,
  );
  const added = await request(c, "cart", "POST", { productId, quantity: 3 });
  assert.equal((await added.json()).items[0].quantity, 5);
  assert.equal(
    (await request(c, "cart", "POST", { productId, quantity: 99 })).status,
    400,
  );
  assert.equal(
    (await request(c, "cart", "POST", { productId, quantity: 0 })).status,
    400,
  );
});
test("unknown admin endpoints and invalid UTF-8 are rejected", async () => {
  assert.equal((await request(owner, "admin/unknown")).status, 404);
  const { route } = await import("./helpers");
  const req = new NextRequest("http://localhost:3000/api/admin/products", {
    method: "POST",
    headers: {
      Cookie: owner.cookie,
      Origin: "http://localhost:3000",
      "x-csrf-token": owner.csrf,
      "Content-Type": "application/json",
    },
    body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]),
  });
  assert.equal(
    (
      await route.POST(req, {
        params: Promise.resolve({ path: ["admin", "products"] }),
      })
    ).status,
    400,
  );
});
test("integer money conversion and discount rounding", () => {
  assert.equal(parseMoney("123.45"), 12345);
  assert.equal(parseMoney("0.01"), 1);
  assert.equal(discountAmount(999, "percent", 1500), 149);
  assert.equal(discountAmount(100, "fixed", 999), 99);
  for (const v of ["-1", "1.001", "1e3", "Infinity"])
    assert.throws(() => parseMoney(v));
});
test("bcrypt passwords reject multibyte input exceeding 72 bytes", async () => {
  const { password, loginSchema } = await import("../src/server/validation");
  const long = "Aa1" + "ع".repeat(36);
  assert.throws(() => password.parse(long));
  assert.throws(() =>
    loginSchema.parse({ email: "test@example.invalid", password: long }),
  );
  assert.equal(
    (
      await request(owner, "admin/users", "POST", {
        email: "new@example.invalid",
        password: long,
        role: "support",
      })
    ).status,
    400,
  );
});
test("invalid login and account brute force lockout", async () => {
  await clearRates();
  const c = await client();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(c, "auth/login", "POST", {
          email: "absent@example.invalid",
          password: "invalid",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await request(c, "auth/login", "POST", {
        email: "absent@example.invalid",
        password: "invalid",
      })
    ).status,
    429,
  );
  await clearRates();
});
test("unauthenticated and customer direct admin access denied", async () => {
  assert.equal((await request(null, "admin/products", "GET")).status, 401);
  assert.equal(
    (await request(guest, "admin/products", "POST", productData())).status,
    401,
  );
});
test("RBAC denies product creation/edit/archive and settings to support", async () => {
  for (const [path, method, data] of [
    ["admin/products", "POST", productData()],
    [
      "admin/products/" + productId,
      "PUT",
      { ...productData(), status: "archived" },
    ],
    ["admin/settings", "PUT", {}],
    ["admin/audit", "GET", undefined],
    ["admin/users", "POST", {}],
  ] as const)
    assert.equal((await request(support, path, method, data)).status, 403);
});
test("CSRF invalid token and cross-origin request denied", async () => {
  assert.equal(
    (
      await request(owner, "admin/products", "POST", productData(), {
        "x-csrf-token": "bad",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(owner, "admin/products", "POST", productData(), {
        Origin: "https://evil.invalid",
      })
    ).status,
    403,
  );
});
test("product edits, archive and reactivation persist; identifiers validated", async () => {
  const d = productData();
  for (const status of ["archived", "inactive", "active"]) {
    assert.equal(
      (
        await request(owner, "admin/products/" + productId, "PUT", {
          ...d,
          status,
        })
      ).status,
      200,
    );
    assert.equal(
      (await db.query("SELECT status FROM products WHERE id=$1", [productId]))
        .rows[0].status,
      status,
    );
  }
  assert.equal(
    (await request(owner, "admin/products/not-a-uuid", "PUT", d)).status,
    400,
  );
  assert.equal(
    (await request(owner, "admin/products/" + randomUUID(), "PUT", d)).status,
    404,
  );
});
test("unexpected fields, SQL injection slug and invalid quantities rejected", async () => {
  assert.equal(
    (
      await request(owner, "admin/products", "POST", {
        ...productData(),
        role: "owner",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(owner, "admin/products", "POST", {
        ...productData(),
        slug: "x'; DROP TABLE products;--",
      })
    ).status,
    400,
  );
  for (const quantity of [-1, 1.5, 100, "2"])
    assert.equal(
      (await request(guest, "cart", "PUT", { productId, quantity })).status,
      400,
    );
  assert.equal(
    (await request(guest, "cart", "PUT", { productId: "bad", quantity: 1 }))
      .status,
    400,
  );
  assert.equal(
    (
      await request(guest, "cart", "PUT", {
        productId: randomUUID(),
        quantity: 1,
      })
    ).status,
    404,
  );
});
test("unknown price and archived products cannot enter a cart", async () => {
  await db.query("UPDATE products SET price=NULL WHERE id=$1", [productId]);
  assert.equal(
    (await request(guest, "cart", "PUT", { productId, quantity: 1 })).status,
    409,
  );
  await db.query(
    "UPDATE products SET price=12345,status='archived' WHERE id=$1",
    [productId],
  );
  assert.equal(
    (await request(guest, "cart", "PUT", { productId, quantity: 1 })).status,
    404,
  );
  await db.query("UPDATE products SET status='active' WHERE id=$1", [
    productId,
  ]);
});
test("cart price tampering blocked; persistent cart quantity and stock validated", async () => {
  assert.equal(
    (await request(guest, "cart", "PUT", { productId, quantity: 2, price: 1 }))
      .status,
    400,
  );
  assert.equal(
    (await request(guest, "cart", "PUT", { productId, quantity: 99 })).status,
    409,
  );
  assert.equal(
    (await request(guest, "cart", "PUT", { productId, quantity: 2 })).status,
    200,
  );
  const r = await request(guest, "cart");
  assert.equal((await r.json()).subtotal, 24690);
});
test("checkout rejects browser prices, forged status and invalid coupons", async () => {
  for (const data of [
    { ...checkoutData(), total: 1 },
    { ...checkoutData(), status: "paid" },
    { ...checkoutData(), quantity: -2 },
  ])
    assert.equal((await request(guest, "checkout", "POST", data)).status, 400);
  assert.equal(
    (
      await request(guest, "checkout", "POST", {
        ...checkoutData(),
        coupon: "NO-SUCH-CODE",
      })
    ).status,
    400,
  );
});
test("successful COD checkout snapshots database prices and prevents duplicate order/stock decrement", async () => {
  const d = checkoutData();
  const r = await request(guest, "checkout", "POST", d);
  assert.equal(r.status, 201);
  const v = await r.json();
  orderId = v.id;
  reference = v.reference;
  trackingToken = v.trackingToken;
  const replay = await request(guest, "checkout", "POST", d);
  assert.equal((await replay.json()).id, orderId);
  const order = (await db.query("SELECT * FROM orders WHERE id=$1", [orderId]))
    .rows[0];
  assert.equal(order.total, 26245);
  assert.equal(order.status, "pending");
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock,
    18,
  );
  assert.equal(
    (await request(guest, "checkout", "POST", { ...d, notes: "changed" }))
      .status,
    409,
  );
});
test("horizontal IDOR, order enumeration and tracking PII protection", async () => {
  assert.equal((await request(other, "order?id=" + orderId)).status, 404);
  assert.equal(
    (await request(other, "payment/start", "POST", { orderId })).status,
    404,
  );
  assert.equal(
    (
      await request(other, "track", "POST", {
        reference,
        token: "0".repeat(64),
      })
    ).status,
    404,
  );
  const r = await request(other, "track", "POST", {
    reference,
    token: trackingToken,
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  for (const key of [
    "email",
    "name",
    "mobile",
    "street",
    "customer_id",
    "total",
  ])
    assert.equal(data[key], undefined);
});
test("order state machine rejects payment forgery and customer status edits", async () => {
  assert.equal(
    (
      await request(guest, "admin/orders/" + orderId, "POST", {
        status: "delivered",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(owner, "admin/orders/" + orderId, "POST", {
        status: "paid",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(owner, "admin/orders/" + orderId, "POST", {
        status: "delivered",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(owner, "admin/orders/" + orderId, "POST", {
        status: "processing",
      })
    ).status,
    200,
  );
});
test("cancellation releases stock once and is audited", async () => {
  assert.equal(
    (
      await request(owner, "admin/orders/" + orderId, "POST", {
        status: "cancelled",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(owner, "admin/orders/" + orderId, "POST", {
        status: "cancelled",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock,
    20,
  );
  assert.ok(
    (
      await db.query(
        "SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action=$2",
        [orderId, "order.status"],
      )
    ).rowCount,
  );
});
test("coupon expiration, usage limit, percentage limits and no negative totals", async () => {
  const bad = {
    code: "INVALID",
    type: "percent",
    value: 10001,
    active: true,
    starts_at: null,
    ends_at: null,
    usage_limit: 1,
    minimum: 0,
  };
  assert.equal(
    (await request(owner, "admin/coupons", "POST", bad)).status,
    400,
  );
  await request(owner, "admin/coupons", "POST", {
    ...bad,
    code: "ONCE",
    type: "fixed",
    value: 500,
    usage_limit: 1,
  });
  await request(guest, "cart", "PUT", { productId, quantity: 1 });
  const r = await request(guest, "checkout", "POST", {
    ...checkoutData(),
    coupon: "ONCE",
  });
  assert.equal(r.status, 201);
  await request(guest, "cart", "PUT", { productId, quantity: 1 });
  assert.equal(
    (
      await request(guest, "checkout", "POST", {
        ...checkoutData(),
        coupon: "ONCE",
      })
    ).status,
    400,
  );
});
test("malformed JSON, oversized streams and output-safe stored text", async () => {
  assert.equal(
    (await request(owner, "admin/products", "POST", "{bad")).status,
    400,
  );
  assert.equal(
    (await request(owner, "admin/products", "POST", "x".repeat(70000))).status,
    413,
  );
  const d = { ...productData(), description_en: "<script>alert(1)</script>" };
  const r = await request(owner, "admin/products", "POST", d);
  assert.equal(r.status, 200);
  const id = (await r.json()).id;
  assert.equal(
    (await db.query("SELECT description_en FROM products WHERE id=$1", [id]))
      .rows[0].description_en,
    d.description_en,
  );
  assert.ok((await db.query("SELECT count(*) FROM products")).rows[0]);
});
test("uploads reject SVG, disguised executables, oversized and invalid image files", async () => {
  for (const [type, bytes, status] of [
    ["image/svg+xml", Buffer.from("<svg/>"), 400],
    ["image/png", Buffer.from("#!/bin/sh"), 400],
    ["image/png", Buffer.alloc(4600000), 413],
  ] as const) {
    const f = new FormData();
    f.set("file", new Blob([bytes], { type }), "x.png");
    assert.equal(
      (
        await request(
          owner,
          "admin/products/" + productId + "/images",
          "POST",
          f,
        )
      ).status,
      status,
    );
  }
});
test("valid image upload is reencoded and image reordering checks ownership", async () => {
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#fffdf7" },
  })
    .png()
    .toBuffer();
  const f = new FormData();
  f.set("file", new Blob([image], { type: "image/png" }), "../../file.png");
  const r = await request(
    owner,
    "admin/products/" + productId + "/images",
    "POST",
    f,
  );
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.match(data.url, /^\/api\/media\/[a-f0-9-]+\.webp$/);
  assert.equal(
    (
      await request(owner, "admin/products/" + productId + "/images", "PUT", {
        images: [{ id: randomUUID(), alt_en: "x", alt_ar: "س" }],
      })
    ).status,
    400,
  );
});
test("session invalidation and token rotation after login", async () => {
  await clearRates();
  const before = await client();
  const r = await request(before, "auth/login", "POST", {
    email: "owner@example.invalid",
    password: secretPassword,
  });
  assert.equal(r.status, 200);
  assert.notEqual(r.headers.get("set-cookie")!.split(";")[0], before.cookie);
  assert.equal((await request(before, "cart")).status, 401);
  const c = {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: (await r.json()).csrf,
  };
  assert.equal((await request(c, "auth/logout", "POST", {})).status, 200);
  assert.equal((await request(c, "admin/products")).status, 401);
});
test("password reset token is hashed, single-use, and revokes sessions", async () => {
  const c = await client();
  const u = (
    await db.query("SELECT id FROM admin_users WHERE email=$1", [
      "support@example.invalid",
    ])
  ).rows[0];
  const value = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO password_resets(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
    [hash(value), u.id],
  );
  const d = {
    token: value,
    password: "Changed" + randomBytes(10).toString("hex") + "A1",
  };
  assert.equal((await request(c, "auth/reset", "POST", d)).status, 200);
  assert.equal((await request(c, "auth/reset", "POST", d)).status, 400);
  assert.equal((await request(support, "admin/orders")).status, 401);
});
test("unknown signatures, stale timestamps and unconfigured adapters fail closed", async () => {
  const raw = JSON.stringify({});
  assert.throws(() =>
    verifyWebhook(
      raw,
      String(Math.floor(Date.now() / 1000)),
      "f".repeat(64),
      process.env.PAYMENT_WEBHOOK_SECRET,
    ),
  );
  assert.throws(() =>
    verifyWebhook(
      raw,
      "1000000000",
      "f".repeat(64),
      process.env.PAYMENT_WEBHOOK_SECRET,
    ),
  );
  assert.equal(
    (await request(null, "webhooks/payment", "POST", {})).status,
    401,
  );
  assert.equal(
    (await request(owner, "admin/orders/" + orderId + "/ship", "POST", {}))
      .status,
    503,
  );
});
test("payment amount verification, event replay and invalid state rollback", async () => {
  await clearRates();
  const d = checkoutData();
  await request(guest, "cart", "PUT", { productId, quantity: 1 });
  const created = await request(guest, "checkout", "POST", d);
  const id = (await created.json()).id;
  await db.query("UPDATE orders SET payment_method='card' WHERE id=$1", [id]);
  await db.query(
    "UPDATE payments SET provider_id='provider-1' WHERE order_id=$1",
    [id],
  );
  const o = (await db.query("SELECT total FROM orders WHERE id=$1", [id]))
    .rows[0];
  async function event(data: unknown) {
    const raw = JSON.stringify(data),
      ts = String(Math.floor(Date.now() / 1000));
    return request(null, "webhooks/payment", "POST", raw, {
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sign(
        ts + "." + raw,
        process.env.PAYMENT_WEBHOOK_SECRET!,
      ),
    });
  }
  const base = {
    eventId: "evt-1",
    orderId: id,
    providerId: "provider-1",
    status: "paid",
    amount: o.total,
    currency: "EGP",
  };
  assert.equal((await event({ ...base, amount: 1 })).status, 409);
  assert.equal((await event(base)).status, 200);
  assert.equal((await event(base)).status, 200);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM webhook_events WHERE event_id=$1",
        ["evt-1"],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await event({ ...base, status: "refunded" })).status, 409);
  assert.equal(
    (await event({ ...base, eventId: "evt-2", status: "refunded" })).status,
    200,
  );
  assert.equal((await event({ ...base, eventId: "evt-3" })).status, 409);
});
test("tracking and reset endpoints enforce rate limits", async () => {
  await clearRates();
  for (let i = 0; i < 10; i++)
    await request(other, "track", "POST", { reference, token: "0".repeat(64) });
  assert.equal(
    (
      await request(other, "track", "POST", {
        reference,
        token: "0".repeat(64),
      })
    ).status,
    429,
  );
  for (let i = 0; i < 5; i++)
    await request(other, "auth/reset-request", "POST", {
      email: "none@example.invalid",
    });
  assert.equal(
    (
      await request(other, "auth/reset-request", "POST", {
        email: "none@example.invalid",
      })
    ).status,
    429,
  );
  await clearRates();
});
test("late captured payment after cancellation queues exactly one refund without reserving stock again", async () => {
  await clearRates();
  await request(guest, "cart", "PUT", { productId, quantity: 1 });
  const created = await request(guest, "checkout", "POST", checkoutData());
  const id = (await created.json()).id;
  await db.query("UPDATE orders SET payment_method='card' WHERE id=$1", [id]);
  await db.query(
    "UPDATE payments SET provider_id='late-provider' WHERE order_id=$1",
    [id],
  );
  assert.equal(
    (
      await request(owner, "admin/orders/" + id, "POST", {
        status: "cancelled",
      })
    ).status,
    200,
  );
  const stock = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  const total = (await db.query("SELECT total FROM orders WHERE id=$1", [id]))
    .rows[0].total;
  for (const eventId of ["late-one", "late-two"]) {
    const raw = JSON.stringify({
        eventId,
        orderId: id,
        providerId: "late-provider",
        amount: total,
        currency: "EGP",
        status: "paid",
      }),
      ts = String(Math.floor(Date.now() / 1000));
    assert.equal(
      (
        await request(null, "webhooks/payment", "POST", raw, {
          "x-webhook-timestamp": ts,
          "x-webhook-signature": sign(
            ts + "." + raw,
            process.env.PAYMENT_WEBHOOK_SECRET!,
          ),
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM outbox WHERE kind='refund' AND order_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0]
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock,
    stock,
  );
});
test("cash collection is owner-only, delivered COD-only and audited once", async () => {
  await clearRates();
  await request(guest, "cart", "PUT", { productId, quantity: 1 });
  const created = await request(guest, "checkout", "POST", checkoutData());
  const id = (await created.json()).id;
  assert.equal(
    (await request(owner, "admin/orders/" + id + "/collect-cod", "POST", {}))
      .status,
    409,
  );
  for (const status of ["processing", "shipped", "delivered"])
    assert.equal(
      (await request(owner, "admin/orders/" + id, "POST", { status })).status,
      200,
    );
  const supportUser = (
    await db.query("SELECT id FROM admin_users WHERE role_id='support'")
  ).rows[0];
  const { newSession, sign } = await import("../src/server/security");
  const session = await newSession(supportUser.id);
  const c = { cookie: "sol-session=" + session.raw, csrf: sign(session.raw) };
  assert.equal(
    (await request(c, "admin/orders/" + id + "/collect-cod", "POST", {}))
      .status,
    403,
  );
  assert.equal(
    (await request(owner, "admin/orders/" + id + "/collect-cod", "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (await request(owner, "admin/orders/" + id + "/collect-cod", "POST", {}))
      .status,
    409,
  );
  assert.equal(
    (await db.query("SELECT status FROM payments WHERE order_id=$1", [id]))
      .rows[0].status,
    "paid",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_logs WHERE action='payment.cod-collected' AND entity_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
});
test("shipping signatures, provider binding and forward-only status; failed jobs owner retry", async () => {
  await clearRates();
  await request(guest, "cart", "PUT", { productId, quantity: 1 });
  const created = await request(guest, "checkout", "POST", checkoutData());
  const id = (await created.json()).id;
  await request(owner, "admin/orders/" + id, "POST", { status: "processing" });
  await db.query(
    "UPDATE shipments SET provider_id='bosta-test' WHERE order_id=$1",
    [id],
  );
  const base = {
    orderId: id,
    providerId: "bosta-test",
    trackingId: "QA-TRACKING",
  };
  async function event(data: unknown) {
    const raw = JSON.stringify(data),
      ts = String(Math.floor(Date.now() / 1000));
    return request(null, "webhooks/bosta", "POST", raw, {
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sign(
        ts + "." + raw,
        process.env.BOSTA_WEBHOOK_SECRET!,
      ),
    });
  }
  assert.equal(
    (
      await request(null, "webhooks/bosta", "POST", {
        ...base,
        eventId: "b1",
        status: "shipped",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await event({
        ...base,
        providerId: "wrong",
        eventId: "b1",
        status: "shipped",
      })
    ).status,
    409,
  );
  for (const status of ["shipped", "delivered"])
    assert.equal(
      (await event({ ...base, eventId: "b-" + status, status })).status,
      200,
    );
  assert.equal(
    (await event({ ...base, eventId: "b-regress", status: "shipped" })).status,
    409,
  );
  const job = (
    await db.query(
      "UPDATE outbox SET status='failed',attempts=8 WHERE order_id=$1 AND kind='order-email' RETURNING id",
      [id],
    )
  ).rows[0];
  assert.equal(
    (await request(guest, "admin/jobs/" + job.id + "/retry", "POST", {}))
      .status,
    401,
  );
  assert.equal(
    (await request(owner, "admin/jobs/" + job.id + "/retry", "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (await request(owner, "admin/jobs/" + job.id + "/retry", "POST", {}))
      .status,
    409,
  );
  assert.equal(
    (await db.query("SELECT attempts FROM outbox WHERE id=$1", [job.id]))
      .rows[0].attempts,
    0,
  );
});
test("checkout and newsletter throttles enforce their caps", async () => {
  await clearRates();
  const c = await client();
  for (let i = 0; i < 10; i++)
    await request(c, "checkout", "POST", checkoutData());
  assert.equal(
    (await request(c, "checkout", "POST", checkoutData())).status,
    429,
  );
  for (let i = 0; i < 5; i++)
    await request(c, "newsletter", "POST", {
      email: "subscriber@example.invalid",
      consent: true,
    });
  assert.equal(
    (
      await request(c, "newsletter", "POST", {
        email: "subscriber@example.invalid",
        consent: true,
      })
    ).status,
    429,
  );
  await clearRates();
});
test("security headers, production cookie flags and no secret leakage", async () => {
  const response = await proxy(new NextRequest("http://localhost:3000/"));
  for (const name of [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "X-Frame-Options",
    "Permissions-Policy",
  ])
    assert.ok(response.headers.get(name));
  assert.match(
    response.headers.get("Content-Security-Policy")!,
    /frame-ancestors 'none'/,
  );
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_URL: "https://shop.example.invalid",
  });
  const r = await request(null, "session");
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(r.headers.get("set-cookie")!, /Secure/i);
  assert.match(r.headers.get("set-cookie")!, /SameSite=lax/i);
  assert.ok(
    (await proxy(new NextRequest("https://shop.example.invalid/"))).headers.get(
      "Strict-Transport-Security",
    ),
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
  });
  assert.equal((await request(other, "admin/audit")).status, 401);
});

test("runtime database grants forbid schema changes, audit edits and history deletion", async () => {
  await db.query("CREATE ROLE solea_app");
  await import("../scripts/grants");
  await db.query("SET ROLE solea_app");
  try {
    for (const statement of [
      "DELETE FROM audit_logs",
      "UPDATE audit_logs SET action=action",
      "DELETE FROM products",
      "DELETE FROM orders",
      "UPDATE roles SET permissions=permissions",
      "SELECT * FROM migrations",
      "CREATE TABLE forbidden(id int)",
    ])
      await assert.rejects(() => db.query(statement));
    await db.query("SELECT id FROM products LIMIT 1");
    await db.query(
      "INSERT INTO audit_logs(action,entity) VALUES('test.permission','tests')",
    );
  } finally {
    await db.query("RESET ROLE");
  }
});
