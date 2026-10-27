import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import {
  db,
  engine,
  request,
  auth,
  customerClient,
  clearRates,
  type Client,
} from "./helpers";
const { manualPaymentSettings } = await import("../src/server/manual-payments");
const { expireIncompleteManualPayments } =
  await import("../src/server/manual-submissions");
let owner: Client, support: Client, productId: string;
after(() => engine.close());
beforeEach(clearRates);
before(async () => {
  const password = "FixturePassword9!";
  for (const role of ["owner", "support"])
    await db.query(
      "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,$3)",
      [`${role}@test.invalid`, await bcrypt.hash(password, 4), role],
    );
  owner = await auth("owner@test.invalid", password);
  support = await auth("support@test.invalid", password);
  productId = (
    await db.query(
      "INSERT INTO products(sku,slug,name_en,name_ar,description_en,description_ar,volume,price,status) VALUES('TEST','test-upgrade','Test','اختبار','','','125 mL',10000,'active') RETURNING id",
    )
  ).rows[0].id;
  await db.query("INSERT INTO inventory(product_id,stock) VALUES($1,100)", [
    productId,
  ]);
  await db.query(
    `UPDATE store_settings SET enabled=true,cod_enabled=true,shipping_zones='[{"governorate":"Cairo","zone":"","fee":1500,"active":true}]'`,
  );
  for (const key of ["privacy", "terms", "returns", "shipping-policy"])
    await db.query("INSERT INTO content(key,published) VALUES($1,true)", [key]);
});
async function order(method = "instapay") {
  const customer = await customerClient();
  await request(customer, "cart", "POST", { productId, quantity: 1 });
  const data = {
    idempotencyKey: randomUUID(),
    fullName: "Test Customer",
    mobile: "01000000000",
    email: "test@example.invalid",
    governorate: "Cairo",
    city: "City",
    street: "Street",
    building: "1",
    floor: "2",
    apartment: "3",
    notes: "",
    payment: method,
    transferReference: "",
    coupon: "",
    locale: "en",
    acceptTerms: true,
  };
  const response = await request(customer, "checkout", "POST", data);
  assert.equal(response.status, 201);
  return { customer, ...(await response.json()), data };
}
async function proof(o: { id: string; customer: Client }) {
  const form = new FormData();
  form.set("orderId", o.id);
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  form.set("file", new File([image], "screenshot.png", { type: "image/png" }));
  return request(o.customer, "payment-proof", "POST", form);
}
const transfer = (id: string, reference = "") => ({
  orderId: id,
  senderPhone: "01000000000",
  transferredAmount: 11500,
  reference,
});
async function submit(o: { id: string; customer: Client }, reference = "") {
  assert.equal((await proof(o)).status, 200);
  assert.equal(
    (
      await request(
        o.customer,
        "payment-submission",
        "POST",
        transfer(o.id, reference),
      )
    ).status,
    200,
  );
}
async function approval(o: { id: string }) {
  return {
    submissionVersion: (
      await db.query(
        "SELECT submission_version FROM payments WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].submission_version,
    whatsappVerified: true,
    receivedAmountVerified: true,
  };
}
const dashboard = async () => (await request(owner, "admin/dashboard")).json();
async function backup() {
  return (
    await db.query(
      "INSERT INTO reporting_backups(label,sha256,bytes) VALUES('isolated fixture',$1,1234) RETURNING id",
      [randomBytes(32).toString("hex")],
    )
  ).rows[0].id;
}

test("reporting reset is backup-gated, auditable, reversible, leaves history and stock intact, and counts new paid transactions once", async () => {
  const old = await order();
  await submit(old);
  assert.equal(
    (
      await request(
        owner,
        `admin/orders/${old.id}/confirm-payment`,
        "POST",
        await approval(old),
      )
    ).status,
    200,
  );
  const before = (await dashboard()).metrics;
  const stock = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  assert.equal(
    (
      await request(owner, "admin/reporting", "POST", {
        action: "reset",
        backupId: randomUUID(),
        expectedPeriodId: null,
        confirmation: "RESET",
      })
    ).status,
    409,
  );
  const reset = await request(owner, "admin/reporting", "POST", {
    action: "reset",
    backupId: await backup(),
    expectedPeriodId: null,
    confirmation: "RESET",
  });
  assert.equal(reset.status, 200);
  const period = (await reset.json()).periodId;
  const zero = (await dashboard()).metrics;
  for (const metric of Object.values(zero)) assert.equal(metric, 0);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM orders WHERE id=$1", [old.id]))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock,
    stock,
  );
  const next = await order("vodafone_cash");
  await submit(next);
  assert.equal((await dashboard()).metrics.revenue, 0);
  assert.equal((await dashboard()).metrics.total_orders, 1);
  assert.equal(
    (
      await request(
        owner,
        `admin/orders/${next.id}/confirm-payment`,
        "POST",
        await approval(next),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        owner,
        `admin/orders/${next.id}/confirm-payment`,
        "POST",
        await approval(next),
      )
    ).status,
    409,
  );
  assert.equal((await dashboard()).metrics.revenue, 11500);
  const rejected = await order();
  await submit(rejected);
  assert.equal(
    (
      await request(
        owner,
        `admin/orders/${rejected.id}/reject-payment`,
        "POST",
        { submissionVersion: 2, reason: "Not received" },
      )
    ).status,
    200,
  );
  assert.equal((await dashboard()).metrics.revenue, 11500);
  assert.equal((await dashboard()).metrics.cancelled_orders, 1);
  assert.equal(
    (
      await request(owner, "admin/reporting", "POST", {
        action: "restore",
        periodId: null,
        expectedPeriodId: period,
      })
    ).status,
    200,
  );
  assert.equal((await dashboard()).metrics.revenue, before.revenue + 11500);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_logs WHERE action IN ('reporting.reset','reporting.restore')",
      )
    ).rows[0].n,
    2,
  );
});

test("reporting mutations reject customers, lower roles, CSRF and stale period selection; runtime cannot forge backup receipts", async () => {
  const data = {
    action: "reset",
    backupId: await backup(),
    expectedPeriodId: null,
    confirmation: "RESET",
  };
  assert.equal(
    (await request(await customerClient(), "admin/reporting", "POST", data))
      .status,
    401,
  );
  assert.equal(
    (await request(support, "admin/reporting", "POST", data)).status,
    403,
  );
  assert.equal(
    (
      await request(owner, "admin/reporting", "POST", data, {
        "x-csrf-token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(owner, "admin/reporting", "POST", {
        ...data,
        expectedPeriodId: randomUUID(),
      })
    ).status,
    409,
  );
  await db.query("CREATE ROLE solea_app");
  await import("../scripts/grants");
  await db.query("SET ROLE solea_app");
  try {
    await assert.rejects(
      db.query(
        "INSERT INTO reporting_backups(label,sha256,bytes) VALUES('forged',repeat('a',64),1)",
      ),
    );
    await assert.rejects(db.query("DELETE FROM reporting_periods"));
    await assert.rejects(db.query("DELETE FROM audit_logs"));
    assert.equal(
      (await request(owner, "admin/reporting", "POST", data)).status,
      200,
    );
  } finally {
    await db.query("RESET ROLE");
  }
});

for (const method of ["instapay", "vodafone_cash"])
  test(`${method}: screenshot/details mandatory, WhatsApp uses owned server data, only reviewed funds can be approved`, async () => {
    const o = await order(method);
    const other = await customerClient();
    assert.equal(
      (await request(o.customer, "payment-submission", "POST", transfer(o.id)))
        .status,
      409,
    );
    assert.equal(
      (await request(o.customer, `payment-whatsapp?orderId=${o.id}`)).status,
      409,
    );
    assert.equal(
      (
        await request(owner, `admin/orders/${o.id}/confirm-payment`, "POST", {
          submissionVersion: 1,
          whatsappVerified: true,
          receivedAmountVerified: true,
        })
      ).status,
      409,
    );
    assert.equal((await proof(o)).status, 200);
    assert.equal(
      (
        await request(o.customer, "payment-submission", "POST", {
          ...transfer(o.id),
          transferredAmount: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(o.customer, "payment-submission", "POST", {
          ...transfer(o.id),
          status: "paid",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(other, "payment-submission", "POST", transfer(o.id)))
        .status,
      404,
    );
    assert.equal(
      (await request(o.customer, "payment-submission", "POST", transfer(o.id)))
        .status,
      200,
    );
    const whatsapp = await request(
      o.customer,
      `payment-whatsapp?orderId=${o.id}&locale=en`,
    );
    assert.equal(whatsapp.status, 200);
    const url = new URL((await whatsapp.json()).url);
    assert.equal(url.origin, "https://wa.me");
    assert.equal(url.pathname, "/201039010190");
    const text = url.searchParams.get("text")!;
    assert.match(text, /115.00 EGP/);
    assert.ok(text.includes(o.reference));
    assert.match(text, /Sender Phone Number: 01000000000/);
    assert.match(text, /manually|attach my payment screenshot/);
    assert.doesNotMatch(text, /tracking|storage|token|signedUrl/i);
    assert.equal(
      (await request(other, `payment-whatsapp?orderId=${o.id}`)).status,
      404,
    );
    assert.equal(
      (await request(other, `admin/orders/${o.id}/payment-proof`)).status,
      401,
    );
    assert.equal(
      (await request(support, `admin/orders/${o.id}/payment-proof-url`)).status,
      403,
    );
    const signed = await request(
      owner,
      `admin/orders/${o.id}/payment-proof-url`,
    );
    assert.equal(signed.status, 200);
    assert.equal((await signed.json()).expiresIn, 60);
    assert.equal(
      (await request(owner, `admin/orders/${o.id}/confirm-payment`, "POST", {}))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          o.customer,
          `admin/orders/${o.id}/confirm-payment`,
          "POST",
          await approval(o),
        )
      ).status,
      401,
    );
    assert.equal(
      (await db.query("SELECT status FROM payments WHERE order_id=$1", [o.id]))
        .rows[0].status,
      "awaiting_confirmation",
    );
    const snapshot = await approval(o);
    await proof(o);
    assert.equal(
      (
        await request(
          owner,
          `admin/orders/${o.id}/confirm-payment`,
          "POST",
          snapshot,
        )
      ).status,
      409,
    );
    assert.equal(
      (await request(o.customer, "payment-submission", "POST", transfer(o.id)))
        .status,
      200,
    );
    const repeated = await request(o.customer, "checkout", "POST", o.data);
    assert.equal((await repeated.json()).id, o.id);
    assert.equal(
      (
        await request(
          owner,
          `admin/orders/${o.id}/confirm-payment`,
          "POST",
          await approval(o),
        )
      ).status,
      200,
    );
  });

test("corrections reuse the order without stock deductions and supplied references cannot be reused across orders", async () => {
  const first = await order();
  await submit(first, "UNIQUE-TRANSFER");
  const stock = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  assert.equal(
    (
      await request(owner, `admin/orders/${first.id}/reject-payment`, "POST", {
        submissionVersion: 2,
        reason: "Upload a clearer image",
        allowCorrection: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT status FROM orders WHERE id=$1", [first.id]))
      .rows[0].status,
    "pending",
  );
  await submit(first, "UNIQUE-TRANSFER");
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock,
    stock,
  );
  const second = await order();
  await proof(second);
  assert.equal(
    (
      await request(
        second.customer,
        "payment-submission",
        "POST",
        transfer(second.id, "unique-transfer"),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        owner,
        `admin/orders/${first.id}/confirm-payment`,
        "POST",
        await approval(first),
      )
    ).status,
    200,
  );
});

test("unstarted manual orders expire once, submitted evidence is retained, receiver activation requires explicit verification", async () => {
  const abandoned = await order(),
    submitted = await order();
  await submit(submitted);
  await db.query(
    "UPDATE orders SET created_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])",
    [[abandoned.id, submitted.id]],
  );
  const stock = (
    await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
      productId,
    ])
  ).rows[0].stock;
  assert.equal(await expireIncompleteManualPayments(), 1);
  assert.equal(await expireIncompleteManualPayments(), 0);
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].stock,
    stock + 1,
  );
  assert.equal(
    (await db.query("SELECT status FROM orders WHERE id=$1", [submitted.id]))
      .rows[0].status,
    "pending",
  );
  process.env.INSTAPAY_RECIPIENT_VERIFIED = "false";
  process.env.VODAFONE_CASH_RECIPIENT_VERIFIED = "false";
  assert.equal(manualPaymentSettings().instapay.enabled, false);
  assert.equal(manualPaymentSettings().vodafoneCash.enabled, false);
  process.env.INSTAPAY_RECIPIENT_VERIFIED = "true";
  process.env.VODAFONE_CASH_RECIPIENT_VERIFIED = "true";
});

test("concurrent reporting resets permit only one baseline; stale backup and unknown routes are rejected", async () => {
  const current = (await dashboard()).reporting.period_id;
  const stale = await backup();
  await db.query(
    "UPDATE reporting_backups SET created_at=now()-interval '25 hours' WHERE id=$1",
    [stale],
  );
  assert.equal(
    (
      await request(owner, "admin/reporting", "POST", {
        action: "reset",
        backupId: stale,
        expectedPeriodId: current,
        confirmation: "RESET",
      })
    ).status,
    409,
  );
  assert.equal((await request(owner, "admin/reporting/unknown")).status, 404);
  const ids = [await backup(), await backup()];
  const result = await Promise.all(
    ids.map((backupId) =>
      request(owner, "admin/reporting", "POST", {
        action: "reset",
        backupId,
        expectedPeriodId: current,
        confirmation: "RESET",
      }),
    ),
  );
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
});

test("pending manual review queue and concurrent approvals keep one payment/audit event", async () => {
  const o = await order();
  await submit(o);
  const queue = await request(owner, "admin/orders?paymentReview=pending");
  assert.equal(queue.status, 200);
  assert.ok((await queue.json()).some((r: { id: string }) => r.id === o.id));
  const data = await approval(o);
  const responses = await Promise.all([
    request(owner, `admin/orders/${o.id}/confirm-payment`, "POST", data),
    request(owner, `admin/orders/${o.id}/confirm-payment`, "POST", data),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_logs WHERE action='payment.manual-paid' AND entity_id=$1",
        [o.id],
      )
    ).rows[0].n,
    1,
  );
  assert.ok(
    !(
      await (await request(owner, "admin/orders?paymentReview=pending")).json()
    ).some((r: { id: string }) => r.id === o.id),
  );
});
