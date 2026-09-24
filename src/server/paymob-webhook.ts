import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { audit, transaction } from "./db";
import { enqueue, releaseStock } from "./commerce";
import { requireCondition } from "./config";
import {
  parseAndVerifyPaymobCallback,
  paymobMerchantReference,
  paymobProviderOrderId,
} from "./paymob";

export async function paymobWebhook(req: NextRequest, raw: string) {
  const payload = JSON.parse(raw) as unknown;
  const data = parseAndVerifyPaymobCallback(
    payload,
    req.nextUrl.searchParams.get("hmac"),
  );
  const eventId = String(data.obj.id);
  const payloadHash = createHash("sha256").update(raw).digest("hex");
  return transaction(async (db) => {
    const prior = (
      await db.query(
        "SELECT payload_hash FROM webhook_events WHERE provider='paymob' AND event_id=$1",
        [eventId],
      )
    ).rows[0];
    if (prior) {
      requireCondition(
        prior.payload_hash === payloadHash,
        409,
        "EVENT_CONFLICT",
      );
      return { ok: true, duplicate: true };
    }
    const reference = paymobMerchantReference(data);
    const providerOrderId = paymobProviderOrderId(data);
    const order = (
      await db.query(
        `SELECT o.*,p.status payment_status,p.amount payment_amount,
         p.provider_order_id,p.provider_transaction_id
         FROM orders o JOIN payments p ON p.order_id=o.id
         WHERE p.provider_order_id=$1 FOR UPDATE OF o,p`,
        [providerOrderId],
      )
    ).rows[0];
    requireCondition(
      order && order.payment_method === "paymob",
      404,
      "ORDER_NOT_FOUND",
    );
    if (reference)
      requireCondition(reference === order.reference, 409, "PROVIDER_MISMATCH");
    requireCondition(
      order.provider_order_id === providerOrderId,
      409,
      "PROVIDER_MISMATCH",
    );
    requireCondition(
      data.obj.amount_cents === order.total &&
        data.obj.amount_cents === order.payment_amount &&
        data.obj.currency === order.currency,
      409,
      "AMOUNT_MISMATCH",
    );
    let paymentStatus = order.payment_status;
    let recordTransaction = false;
    if (data.obj.is_refunded) {
      requireCondition(
        order.payment_status === "paid",
        409,
        "INVALID_TRANSITION",
      );
      paymentStatus = "refunded";
      await db.query(
        "UPDATE orders SET status='refunded',updated_at=now() WHERE id=$1",
        [order.id],
      );
    } else if (data.obj.pending) {
      requireCondition(
        order.payment_status === "pending",
        409,
        "INVALID_TRANSITION",
      );
    } else if (
      data.obj.success &&
      !data.obj.error_occured &&
      !data.obj.is_voided
    ) {
      requireCondition(
        ["pending", "paid"].includes(order.payment_status),
        409,
        "INVALID_TRANSITION",
      );
      paymentStatus = "paid";
      recordTransaction = true;
      if (order.status === "pending")
        await db.query(
          "UPDATE orders SET status='paid',expires_at=NULL,updated_at=now() WHERE id=$1",
          [order.id],
        );
      else if (order.status === "cancelled")
        await audit(
          db,
          null,
          "payment.paymob-late-payment",
          "orders",
          order.id,
          {
            transaction: eventId,
          },
        );
    } else {
      requireCondition(
        order.payment_status === "pending",
        409,
        "INVALID_TRANSITION",
      );
      paymentStatus = "failed";
      if (order.status === "pending") {
        await releaseStock(db, order);
        await db.query(
          "UPDATE orders SET status='cancelled',expires_at=NULL,updated_at=now() WHERE id=$1",
          [order.id],
        );
      }
    }
    await db.query(
      `UPDATE payments SET status=$1,
       provider_transaction_id=CASE WHEN $2 THEN COALESCE(provider_transaction_id,$3) ELSE provider_transaction_id END,
       updated_at=now()
       WHERE order_id=$4`,
      [paymentStatus, recordTransaction, eventId, order.id],
    );
    await db.query(
      "INSERT INTO webhook_events(provider,event_id,payload_hash) VALUES('paymob',$1,$2)",
      [eventId, payloadHash],
    );
    await audit(db, null, "webhook.paymob", "orders", order.id, {
      paymentStatus,
      transaction: eventId,
    });
    if (["paid", "failed", "refunded"].includes(paymentStatus))
      await enqueue(
        db,
        "status-email",
        order.id,
        `event-email:paymob:${eventId}`,
      );
    return { ok: true };
  });
}
