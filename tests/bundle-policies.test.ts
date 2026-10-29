import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bundleDiscount, twoBottleDiscount } from "../src/lib/promotions";
import policies from "../src/lib/legal-content.json";
import { customerClient, db, engine, request, clearRates } from "./helpers";
let productId = "";
const item = {
  sku: "SOL-125",
  slug: "baby-shampoo",
  price: 24999,
  quantity: 2,
};
const orderData = (payment = "cod", coupon = "") => ({
  idempotencyKey: randomUUID(),
  fullName: "Bundle Test Customer",
  mobile: "01000000000",
  email: "bundle@example.invalid",
  governorate: "Cairo",
  city: "Cairo",
  street: "Test Street",
  building: "1",
  floor: "",
  apartment: "",
  notes: "",
  payment,
  transferReference: "",
  coupon,
  locale: "en",
  acceptTerms: true,
});
before(async () => {
  productId = (
    await db.query(
      "INSERT INTO products(sku,slug,name_en,name_ar,description_en,description_ar,volume,price,status) VALUES('SOL-125','baby-shampoo','Test','اختبار','','','125 mL',24999,'active') RETURNING id",
    )
  ).rows[0].id;
  await db.query("INSERT INTO inventory(product_id,stock) VALUES($1,100)", [
    productId,
  ]);
  await db.query(
    `UPDATE store_settings SET enabled=true,cod_enabled=true,shipping_zones='[{"governorate":"Cairo","zone":"","fee":1500,"active":true}]'`,
  );
  for (const key of ["returns", "shipping-policy"])
    await db.query(
      "INSERT INTO content(key,published) VALUES($1,true) ON CONFLICT(key) DO UPDATE SET published=true",
      [key],
    );
});
after(() => engine.close());

test("bundle uses integer minor units, pairs only, correct SKU, no price increase and no invented comparison", () => {
  for (const [quantity, discount] of [
    [1, 0],
    [2, 4999],
    [3, 4999],
    [4, 9998],
    [0, 0],
    [-2, 0],
    [2.5, 0],
    [100, 0],
  ])
    assert.equal(twoBottleDiscount({ ...item, quantity }), discount);
  assert.equal(twoBottleDiscount({ ...item, sku: "OTHER" }), 0);
  assert.equal(twoBottleDiscount({ ...item, slug: "other" }), 0);
  assert.equal(twoBottleDiscount({ ...item, price: null }), 0);
  assert.equal(twoBottleDiscount({ ...item, price: 20000 }), 0);
  assert.equal(bundleDiscount([item, { ...item, sku: "OTHER" }]), 4999);
});

test("cart and quote apply/remove bundle as quantity changes, with shipping calculated on discounted amount", async () => {
  const customer = await customerClient();
  for (const [quantity, total, discount] of [
    [2, 44999, 4999],
    [1, 24999, 0],
    [3, 69998, 4999],
    [4, 89998, 9998],
  ]) {
    assert.equal(
      (await request(customer, "cart", "PUT", { productId, quantity })).status,
      200,
    );
    const cart = await (await request(customer, "cart")).json();
    assert.equal(cart.total, total);
    assert.equal(cart.discount, discount);
    const quote = await (
      await request(customer, "quote", "POST", {
        governorate: "Cairo",
        coupon: "",
      })
    ).json();
    assert.equal(quote.total, total + 1500);
    assert.equal(quote.discount, discount);
  }
  await db.query("UPDATE store_settings SET free_shipping_threshold=48000");
  await request(customer, "cart", "PUT", { productId, quantity: 2 });
  assert.equal(
    (
      await (
        await request(customer, "quote", "POST", {
          governorate: "Cairo",
          coupon: "",
        })
      ).json()
    ).shipping,
    1500,
  );
  await db.query("UPDATE store_settings SET free_shipping_threshold=NULL");
  await request(customer, "cart", "PUT", { productId, quantity: 0 });
  const empty = await (await request(customer, "cart")).json();
  assert.equal(empty.total, 0);
  assert.equal(empty.discount, 0);
});

for (const payment of ["cod", "instapay", "vodafone_cash"])
  test(`${payment} bundle order persists correct amount, original unit prices and one stock deduction`, async () => {
    await clearRates();
    const customer = await customerClient();
    const stock = (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock;
    await request(customer, "cart", "POST", { productId, quantity: 2 });
    const data = orderData(payment);
    const response = await request(customer, "checkout", "POST", data);
    assert.equal(response.status, 201, await response.clone().text());
    const { id } = await response.json();
    const o = (await db.query("SELECT * FROM orders WHERE id=$1", [id]))
      .rows[0];
    assert.equal(o.subtotal, 49998);
    assert.equal(o.discount, 4999);
    assert.equal(o.total, 46499);
    assert.equal(o.shipping, 1500);
    const lines = (
      await db.query(
        "SELECT unit_price,quantity FROM order_items WHERE order_id=$1",
        [id],
      )
    ).rows;
    assert.deepEqual(lines, [{ unit_price: 24999, quantity: 2 }]);
    const p = (
      await db.query("SELECT amount,status FROM payments WHERE order_id=$1", [
        id,
      ])
    ).rows[0];
    assert.equal(p.amount, 46499);
    assert.notEqual(p.status, "paid");
    assert.equal(
      (await request(customer, "checkout", "POST", data)).status,
      201,
    );
    assert.equal(
      (
        await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
          productId,
        ])
      ).rows[0].stock,
      stock - 2,
    );
    assert.equal(
      (await db.query("SELECT price FROM products WHERE id=$1", [productId]))
        .rows[0].price,
      24999,
    );
  });

test("coupon and bundle never stack and only a selected coupon is consumed", async () => {
  for (const [code, value, expected, used] of [
    ["SMALL", 1000, 4999, 0],
    ["LARGE", 7000, 7000, 1],
  ] as const) {
    await clearRates();
    await db.query(
      "INSERT INTO coupons(code,type,value,usage_limit,active) VALUES($1,'fixed',$2,10,true)",
      [code, value],
    );
    const customer = await customerClient();
    await request(customer, "cart", "POST", { productId, quantity: 2 });
    const quote = await (
      await request(customer, "quote", "POST", {
        governorate: "Cairo",
        coupon: code,
      })
    ).json();
    assert.equal(quote.discount, expected);
    const r = await request(
      customer,
      "checkout",
      "POST",
      orderData("cod", code),
    );
    assert.equal(r.status, 201, await r.clone().text());
    const o = (
      await db.query("SELECT discount,coupon_id FROM orders WHERE id=$1", [
        (await r.json()).id,
      ])
    ).rows[0];
    assert.equal(o.discount, expected);
    assert.equal(!!o.coupon_id, used === 1);
    assert.equal(
      (await db.query("SELECT used FROM coupons WHERE code=$1", [code])).rows[0]
        .used,
      used,
    );
  }
});

test("client bundle totals cannot override pricing and inventory validation remains enforced", async () => {
  await clearRates();
  const customer = await customerClient();
  await request(customer, "cart", "POST", { productId, quantity: 2 });
  assert.equal(
    (
      await request(customer, "checkout", "POST", {
        ...orderData(),
        total: 1,
        discount: 49997,
        payment_status: "paid",
      })
    ).status,
    400,
  );
  const old = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  await db.query("UPDATE inventory SET stock=1 WHERE product_id=$1", [
    productId,
  ]);
  assert.equal(
    (await request(customer, "checkout", "POST", orderData())).status,
    409,
  );
  await db.query("UPDATE inventory SET stock=$2 WHERE product_id=$1", [
    productId,
    old,
  ]);
});

test("013 publishes exactly the bilingual policy source and leaves Returns, Shipping and commerce data intact", async () => {
  const before = (
    await db.query(
      "SELECT key,body_en,body_ar,published FROM content WHERE key IN ('returns','shipping-policy') ORDER BY key",
    )
  ).rows;
  const counts = (
    await db.query("SELECT count(*) n,sum(total) total FROM orders")
  ).rows;
  const settings = (await db.query("SELECT * FROM store_settings")).rows;
  await engine.exec(
    await readFile("migrations/013_complete_customer_policies.sql", "utf8"),
  );
  for (const [key, p] of Object.entries(policies)) {
    const row = (await db.query("SELECT * FROM content WHERE key=$1", [key]))
      .rows[0];
    assert.equal(row.published, true);
    for (const field of ["title_en", "title_ar", "body_en", "body_ar"] as const)
      assert.equal(row[field], p[field]);
    assert.doesNotMatch(
      row.body_en,
      /coming soon|will be published|awaiting.*approval/i,
    );
  }
  assert.deepEqual(
    (
      await db.query(
        "SELECT key,body_en,body_ar,published FROM content WHERE key IN ('returns','shipping-policy') ORDER BY key",
      )
    ).rows,
    before,
  );
  assert.deepEqual(
    (await db.query("SELECT count(*) n,sum(total) total FROM orders")).rows,
    counts,
  );
  assert.deepEqual(
    (await db.query("SELECT * FROM store_settings")).rows,
    settings,
  );
});
