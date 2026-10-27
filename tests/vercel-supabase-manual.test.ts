import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { db, engine, request, client, customerClient, auth, Client } from "./helpers";
const { manualPaymentSettings } = await import("../src/server/manual-payments");

const password = "Aa9" + randomBytes(14).toString("hex");
let owner: Client;
let support: Client;
let productId = "";

const product = {
  sku: "MANUAL-001",
  slug: "manual-product",
  name_en: "SOLÉA Test",
  name_ar: "اختبار SOLÉA",
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
};

function checkoutData(payment: "cod" | "instapay" | "vodafone_cash") {
  return {
    idempotencyKey: randomUUID(),
    fullName: "Manual Payment Test",
    mobile: "01000000000",
    email: "buyer@example.invalid",
    governorate: "Cairo",
    city: "Cairo",
    street: "Test Street",
    building: "1",
    floor: "2",
    apartment: "3",
    notes: "",
    payment,
    transferReference: payment === "cod" ? "" : "REF-123",
    coupon: "",
    locale: "en",
    acceptTerms: true,
  };
}

async function createOrder(payment: "cod" | "instapay" | "vodafone_cash") {
  const customer = await customerClient();
  assert.equal(
    (await request(customer, "cart", "POST", { productId, quantity: 1 })).status,
    200,
  );
  const response = await request(customer, "checkout", "POST", checkoutData(payment));
  assert.equal(response.status, 201);
  return { customer, ...(await response.json()) } as Client & {
    customer: Client;
    id: string;
    reference: string;
  };
}

async function evidence(order:{id:string;customer:Client},reference=""){
 const form=new FormData();form.set("orderId",order.id);
 const image=await sharp({create:{width:20,height:20,channels:3,background:"white"}}).png().toBuffer();
 form.set("file",new File([image],"proof.png",{type:"image/png"}));
 assert.equal((await request(order.customer,"payment-proof","POST",form)).status,200);
 assert.equal((await request(order.customer,"payment-submission","POST",{orderId:order.id,senderPhone:"01000000000",transferredAmount:11500,reference})).status,200);
}
const approval={submissionVersion:2,whatsappVerified:true,receivedAmountVerified:true};

before(async () => {
  for (const [email, role] of [
    ["phase-owner@example.invalid", "owner"],
    ["phase-support@example.invalid", "support"],
  ])
    await db.query(
      "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,$3)",
      [email, await bcrypt.hash(password, 4), role],
    );
  owner = await auth("phase-owner@example.invalid", password);
  support = await auth("phase-support@example.invalid", password);
  const created = await request(owner, "admin/products", "POST", product);
  productId = (await created.json()).id;
  await db.query(
    `UPDATE store_settings SET enabled=true,cod_enabled=true,
     shipping_zones='[{"governorate":"Cairo","zone":"Greater Cairo","fee":1500,"active":true}]'`,
  );
  for (const key of ["terms", "privacy", "returns", "shipping-policy"])
    await db.query("INSERT INTO content(key,published) VALUES($1,true)", [key]);
});

after(async () => engine.close());

test("migration preserves relations and adds manual payment/storage fields", async () => {
  const role = (await db.query("SELECT permissions FROM roles WHERE id='owner'")).rows[0];
  assert.ok(role.permissions.includes("payments"));
  const columns = (
    await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('payments','product_images','store_settings')",
    )
  ).rows.map((r) => r.column_name);
  for (const name of [
    "transfer_reference",
    "proof_storage_path",
    "verified_by",
    "storage_path",
    "shipping_zones",
  ])
    assert.ok(columns.includes(name), name);
});

test("manual payment settings support disabled, identifier-only, and QR states", () => {
  const original = {
    ie: process.env.INSTAPAY_ENABLED,
    ia: process.env.INSTAPAY_ACCOUNT,
    iq: process.env.INSTAPAY_QR_URL,
    ve: process.env.VODAFONE_CASH_ENABLED,
    vn: process.env.VODAFONE_CASH_NUMBER,
    vq: process.env.VODAFONE_CASH_QR_URL,
  };
  Object.assign(process.env, {
    INSTAPAY_ENABLED: "false",
    INSTAPAY_ACCOUNT: "",
    INSTAPAY_QR_URL: "javascript:unsafe",
    VODAFONE_CASH_ENABLED: "false",
    VODAFONE_CASH_NUMBER: "",
    VODAFONE_CASH_QR_URL: "http://unsafe.invalid/qr.png",
  });
  let settings = manualPaymentSettings();
  assert.equal(settings.instapay.enabled, false);
  assert.equal(settings.instapay.qrUrl, "");
  assert.equal(settings.vodafoneCash.enabled, false);
  assert.equal(settings.vodafoneCash.qrUrl, "");

  Object.assign(process.env, {
    INSTAPAY_ENABLED: "true",
    INSTAPAY_ACCOUNT: "test-instapay",
    INSTAPAY_QR_URL: "https://qr.example.invalid/instapay.png",
    VODAFONE_CASH_ENABLED: "true",
    VODAFONE_CASH_NUMBER: "01000000000",
    VODAFONE_CASH_QR_URL: "https://qr.example.invalid/vodafone.png",
  });
  settings = manualPaymentSettings();
  assert.deepEqual(settings.instapay, {
    enabled: true,
    account: "test-instapay",
    qrUrl: "https://qr.example.invalid/instapay.png",
  });
  assert.deepEqual(settings.vodafoneCash, {
    enabled: true,
    number: "01000000000",
    qrUrl: "https://qr.example.invalid/vodafone.png",
  });
  Object.assign(process.env, {
    INSTAPAY_ENABLED: original.ie,
    INSTAPAY_ACCOUNT: original.ia,
    INSTAPAY_QR_URL: original.iq,
    VODAFONE_CASH_ENABLED: original.ve,
    VODAFONE_CASH_NUMBER: original.vn,
    VODAFONE_CASH_QR_URL: original.vq,
  });
});

test("COD and manual checkout use database prices and configured zones", async () => {
  const cod = await createOrder("cod");
  const codRow = (
    await db.query(
      "SELECT o.total,o.payment_method,p.status FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1",
      [cod.id],
    )
  ).rows[0];
  assert.deepEqual(codRow, { total: 11_500, payment_method: "cod", status: "cod_pending" });

  const tamper = await client();
  await request(tamper, "cart", "POST", { productId, quantity: 1 });
  const altered = await request(tamper, "checkout", "POST", {
    ...checkoutData("instapay"),
    total: 1,
  });
  assert.equal(altered.status, 400);

  const insta = await createOrder("instapay");
  const voda = await createOrder("vodafone_cash");
  for (const id of [insta.id, voda.id]) {
    const row = (
      await db.query(
        "SELECT o.total,p.status,p.transfer_reference FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.total, 11_500);
    assert.equal(row.status, "awaiting_confirmation");
    assert.equal(row.transfer_reference, "REF-123");
  }
});

test("proof upload is validated, private and scoped to the owning order", async () => {
  const order = await createOrder("instapay");
  const other = await client();
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "white" },
  }).png().toBuffer();
  const wrong = new FormData();
  wrong.set("orderId", order.id);
  wrong.set("file", new File([image], "proof.png", { type: "image/png" }));
  assert.equal((await request(other, "payment-proof", "POST", wrong)).status, 404);

  const invalid = new FormData();
  invalid.set("orderId", order.id);
  invalid.set("file", new File(["bad"], "proof.svg", { type: "image/svg+xml" }));
  assert.equal((await request(order.customer, "payment-proof", "POST", invalid)).status, 400);

  const valid = new FormData();
  valid.set("orderId", order.id);
  valid.set("file", new File([image], "proof.png", { type: "image/png" }));
  assert.equal((await request(order.customer, "payment-proof", "POST", valid)).status, 200);
  assert.equal(
    (await request(support, `admin/orders/${order.id}/payment-proof`)).status,
    403,
  );
  const proof = await request(owner, `admin/orders/${order.id}/payment-proof`);
  assert.equal(proof.status, 200);
  assert.equal(proof.headers.get("cache-control"), "private,no-store");
});

test("customer payment submission is owner-scoped and cannot change status or amount", async () => {
  const order = await createOrder("instapay");
  const other = await client();
  await evidence(order,"INITIAL");
  assert.equal(
    (
      await request(other, "payment-submission", "POST", {
        orderId: order.id,
        reference: "OTHER-REF",senderPhone:"01000000000",transferredAmount:11500,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(order.customer, "payment-submission", "POST", {
        orderId: order.id,
        reference: "CUSTOMER-REF",senderPhone:"01000000000",transferredAmount:11500,
        status: "paid",
        total: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(order.customer, "payment-submission", "POST", {
        orderId: order.id,
        reference: "CUSTOMER-REF",senderPhone:"01000000000",transferredAmount:11500,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(order.customer, `admin/orders/${order.id}/confirm-payment`, "POST", {})).status,
    401,
  );
  const payment = (
    await db.query(
      "SELECT p.status,p.transfer_reference,p.sender_phone,p.transferred_amount,o.total FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.id=$1",
      [order.id],
    )
  ).rows[0];
  assert.deepEqual(payment, {
    status: "awaiting_confirmation",
    transfer_reference: "CUSTOMER-REF",sender_phone:"01000000000",transferred_amount:11500,
    total: 11_500,
  });
});

test("only payment-authorized admins confirm or reject once and audit the actor", async () => {
  const paid = await createOrder("instapay");
  await evidence(paid);
  assert.equal(
    (await request(support, `admin/orders/${paid.id}/confirm-payment`, "POST", approval)).status,
    403,
  );
  assert.equal(
    (await request(owner, `admin/orders/${paid.id}/confirm-payment`, "POST", approval)).status,
    200,
  );
  assert.equal(
    (await request(owner, `admin/orders/${paid.id}/confirm-payment`, "POST", approval)).status,
    409,
  );
  const paidRow = (
    await db.query("SELECT status,verified_by,verified_at FROM payments WHERE order_id=$1", [paid.id])
  ).rows[0];
  assert.equal(paidRow.status, "paid");
  assert.ok(paidRow.verified_by && paidRow.verified_at);

  const rejected = await createOrder("vodafone_cash");
  await evidence(rejected);
  const beforeStock = (await db.query("SELECT stock FROM inventory WHERE product_id=$1", [productId])).rows[0].stock;
  assert.equal(
    (await request(owner, `admin/orders/${rejected.id}/reject-payment`, "POST", { reason: "Reference not found",submissionVersion:2 })).status,
    200,
  );
  const rejectedRow = (
    await db.query("SELECT p.status payment_status,p.rejection_reason,o.status order_status,o.stock_released FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.id=$1", [rejected.id])
  ).rows[0];
  assert.equal(rejectedRow.payment_status, "rejected");
  assert.equal(rejectedRow.order_status, "cancelled");
  assert.equal(rejectedRow.stock_released, true);
  const afterStock = (await db.query("SELECT stock FROM inventory WHERE product_id=$1", [productId])).rows[0].stock;
  assert.equal(afterStock, beforeStock + 1);
  assert.equal(
    Number((await db.query("SELECT count(*) n FROM audit_logs WHERE entity_id=$1 AND action LIKE 'payment.manual-%'", [paid.id])).rows[0].n),
    1,
  );
});

test("admin product image upload, replace and delete use storage paths", async () => {
  assert.equal(
    (await request(owner, `admin/products/${productId}`, "PUT", { ...product, status: "archived", stock: 20 })).status,
    200,
  );
  assert.equal(
    (await request(owner, `admin/products/${productId}`, "PUT", { ...product, status: "active", stock: 20 })).status,
    200,
  );
  const bad = new FormData();
  bad.set("file", new File(["not-image"], "bad.png", { type: "image/png" }));
  assert.equal((await request(owner, `admin/products/${productId}/images`, "POST", bad)).status, 400);

  const image = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#d8edf2" },
  }).png().toBuffer();
  const upload = new FormData();
  upload.set("file", new File([image], "product.png", { type: "image/png" }));
  const added = await request(owner, `admin/products/${productId}/images`, "POST", upload);
  assert.equal(added.status, 200);
  const row = await added.json();
  assert.match(row.url, /^https:\/\/storage\.example\.invalid\//);
  assert.match(row.storage_path, /^products\//);

  const replacement = new FormData();
  replacement.set("file", new File([image], "replacement.png", { type: "image/png" }));
  assert.equal(
    (await request(owner, `admin/products/${productId}/images/${row.id}`, "PUT", replacement)).status,
    200,
  );
  assert.equal(
    (await request(owner, `admin/products/${productId}/images/${row.id}`, "DELETE")).status,
    200,
  );
  assert.equal(
    Number((await db.query("SELECT count(*) n FROM product_images WHERE id=$1", [row.id])).rows[0].n),
    0,
  );
});
