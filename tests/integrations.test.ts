import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { engine } from "./helpers";
import { createPayment, adapter, sendEmail } from "../src/server/integrations";
const original = globalThis.fetch;
after(async () => {
  globalThis.fetch = original;
  await engine.close();
});
const order = { id: randomUUID(), total: 12345, currency: "EGP" };
test("hosted payment adapter sends server amount and stable idempotency key; never card data", async () => {
  process.env.PAYMENT_ADAPTER_URL = "https://bridge.example.invalid/";
  process.env.PAYMENT_API_KEY = randomBytes(24).toString("hex");
  process.env.PAYMENT_HOSTED_ORIGINS = "https://pay.example.invalid";
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.amount, 12345);
    assert.equal(body.orderId, order.id);
    assert.equal(
      new Headers(options?.headers).get("Idempotency-Key"),
      order.id,
    );
    assert.equal(body.cardNumber, undefined);
    assert.equal(body.cvv, undefined);
    return Response.json({
      providerId: "test-provider",
      checkoutUrl: "https://pay.example.invalid/checkout/test",
    });
  };
  const result = await createPayment(order);
  assert.equal(result.providerId, "test-provider");
});
test("payment redirects reject unapproved origins and insecure URLs", async () => {
  for (const checkoutUrl of [
    "https://evil.invalid/",
    "http://pay.example.invalid/",
  ]) {
    globalThis.fetch = async () =>
      Response.json({ providerId: "test-provider", checkoutUrl });
    await assert.rejects(() => createPayment(order), /INVALID_PROVIDER_URL/);
  }
});
test("provider failures and missing Bosta config fail closed", async () => {
  globalThis.fetch = async () =>
    new Response("private upstream details", { status: 500 });
  await assert.rejects(() => createPayment(order), /PROVIDER_UNAVAILABLE/);
  delete process.env.BOSTA_ADAPTER_URL;
  delete process.env.BOSTA_API_KEY;
  await assert.rejects(
    () => adapter("BOSTA", "shipments", {}, order.id),
    /INTEGRATION_NOT_CONFIGURED/,
  );
});
test("email adapter carries real brand metadata and refuses missing sender", async () => {
  delete process.env.EMAIL_FROM;
  await assert.rejects(
    () => sendEmail("test@example.invalid", "SOLÉA", "Test", order.id),
    /INTEGRATION_NOT_CONFIGURED/,
  );
  process.env.EMAIL_FROM = "test@example.invalid";
  process.env.EMAIL_ADAPTER_URL = "https://mail.example.invalid/";
  process.env.EMAIL_API_KEY = randomBytes(24).toString("hex");
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.brand, "SOLÉA");
    assert.ok(body.logoUrl.endsWith("/media/logo.png"));
    return Response.json({ ok: true });
  };
  await sendEmail("test@example.invalid", "SOLÉA", "Test", order.id);
});
