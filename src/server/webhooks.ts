import { NextRequest } from "next/server";
import { webhookSchema, shippingWebhookSchema } from "./validation";
import { verifyWebhook, hash } from "./security";
import { transaction, audit } from "./db";
import { requireCondition } from "./config";
import { enqueue, releaseStock } from "./commerce";
export async function webhook(req: NextRequest, provider: string, raw: string) {
  verifyWebhook(
    raw,
    req.headers.get("x-webhook-timestamp"),
    req.headers.get("x-webhook-signature"),
    process.env[
      provider === "payment" ? "PAYMENT_WEBHOOK_SECRET" : "BOSTA_WEBHOOK_SECRET"
    ],
  );
  const data =
    provider === "payment"
      ? webhookSchema.parse(JSON.parse(raw))
      : shippingWebhookSchema.parse(JSON.parse(raw));
  return transaction(async (db) => {
    const o = (
      await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
        data.orderId,
      ])
    ).rows[0];
    requireCondition(o, 404, "ORDER_NOT_FOUND");
    const old = (
      await db.query(
        "SELECT payload_hash FROM webhook_events WHERE provider=$1 AND event_id=$2",
        [provider, data.eventId],
      )
    ).rows[0];
    if (old) {
      requireCondition(old.payload_hash === hash(raw), 409, "EVENT_CONFLICT");
      return { ok: true, duplicate: true };
    }
    if (provider === "payment" && "amount" in data) {
      const p = (
        await db.query("SELECT * FROM payments WHERE order_id=$1 FOR UPDATE", [
          o.id,
        ])
      ).rows[0];
      requireCondition(
        o.payment_method === "card" && p.provider_id === data.providerId,
        409,
        "PROVIDER_MISMATCH",
      );
      requireCondition(
        data.amount === o.total &&
          data.amount === p.amount &&
          data.currency === p.currency,
        409,
        "AMOUNT_MISMATCH",
      );
      if (data.status === "paid") {
        requireCondition(
          p.status !== "refunded" && o.status !== "refunded",
          409,
          "INVALID_TRANSITION",
        );
        if (o.status === "cancelled" && o.stock_released) {
          await enqueue(db, "refund", o.id, "refund:" + o.id);
          await audit(db, null, "payment.late-refund", "orders", o.id);
        } else {
          requireCondition(
            ["pending", "paid", "processing", "shipped", "delivered"].includes(
              o.status,
            ) && !o.stock_released,
            409,
            "INVALID_TRANSITION",
          );
          await db.query(
            "UPDATE orders SET status=CASE WHEN status='pending' THEN 'paid' ELSE status END,updated_at=now(),expires_at=NULL WHERE id=$1",
            [o.id],
          );
        }
      } else if (data.status === "refunded") {
        requireCondition(p.status === "paid", 409, "INVALID_TRANSITION");
        await db.query(
          "UPDATE orders SET status='refunded',updated_at=now() WHERE id=$1",
          [o.id],
        );
      } else {
        requireCondition(
          p.status === "pending" && o.status === "pending",
          409,
          "INVALID_TRANSITION",
        );
        await releaseStock(db, o);
        await db.query(
          "UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",
          [o.id],
        );
      }
      await db.query(
        "UPDATE payments SET status=$1,updated_at=now() WHERE order_id=$2",
        [data.status, o.id],
      );
    } else if ("trackingId" in data) {
      const ship = (
        await db.query("SELECT * FROM shipments WHERE order_id=$1 FOR UPDATE", [
          o.id,
        ])
      ).rows[0];
      requireCondition(
        ship.provider_id === data.providerId,
        409,
        "PROVIDER_MISMATCH",
      );
      requireCondition(
        ["processing", "shipped", "delivered"].includes(o.status),
        409,
        "INVALID_TRANSITION",
      );
      requireCondition(
        !(o.status === "delivered" && data.status === "shipped"),
        409,
        "INVALID_TRANSITION",
      );
      await db.query(
        "UPDATE shipments SET status=$1,tracking_id=$2,updated_at=now() WHERE order_id=$3",
        [data.status, data.trackingId, o.id],
      );
      await db.query(
        "UPDATE orders SET status=$1,updated_at=now() WHERE id=$2",
        [data.status, o.id],
      );
    }
    await db.query(
      "INSERT INTO webhook_events(provider,event_id,payload_hash) VALUES($1,$2,$3)",
      [provider, data.eventId, hash(raw)],
    );
    await audit(db, null, "webhook." + provider, "orders", o.id, {
      status: data.status,
      event: data.eventId,
    });
    await enqueue(
      db,
      "status-email",
      o.id,
      "event-email:" + provider + ":" + data.eventId,
    );
    return { ok: true };
  });
}
