import { audit, transaction } from "./db";
import { requireCondition } from "./config";

export function manualPaymentSettings() {
  const instaAccount = process.env.INSTAPAY_ACCOUNT?.trim() || "";
  const vodafoneNumber = process.env.VODAFONE_CASH_NUMBER?.trim() || "";
  const qr = process.env.INSTAPAY_QR_URL?.trim() || "";
  return {
    instapay: {
      enabled: process.env.INSTAPAY_ENABLED === "true" && !!instaAccount,
      account: instaAccount,
      qrUrl: /^https:\/\//.test(qr) ? qr : "",
    },
    vodafoneCash: {
      enabled: process.env.VODAFONE_CASH_ENABLED === "true" && !!vodafoneNumber,
      number: vodafoneNumber,
    },
  };
}

export async function verifyManualPayment(
  actor: string,
  orderId: string,
  decision: "paid" | "rejected",
  reason = "",
) {
  return transaction(async (db) => {
    const order = (
      await db.query(
        `SELECT o.*,p.status payment_status FROM orders o
         JOIN payments p ON p.order_id=o.id
         WHERE o.id=$1 FOR UPDATE OF o,p`,
        [orderId],
      )
    ).rows[0];
    requireCondition(order, 404, "ORDER_NOT_FOUND");
    requireCondition(
      ["instapay", "vodafone_cash"].includes(order.payment_method) &&
        order.payment_status === "awaiting_confirmation" &&
        order.status === "pending",
      409,
      "INVALID_TRANSITION",
    );
    if (decision === "rejected") {
      requireCondition(reason.trim().length > 0, 400, "REJECTION_REASON_REQUIRED");
      if (!order.stock_released) {
        const items = (
          await db.query("SELECT product_id,quantity FROM order_items WHERE order_id=$1", [
            order.id,
          ])
        ).rows;
        for (const item of items)
          await db.query("UPDATE inventory SET stock=stock+$1 WHERE product_id=$2", [
            item.quantity,
            item.product_id,
          ]);
        await db.query("UPDATE orders SET stock_released=true WHERE id=$1", [order.id]);
      }
    }
    await db.query(
      `UPDATE payments SET status=$1,verified_by=$2,verified_at=now(),
       rejection_reason=$3,updated_at=now() WHERE order_id=$4`,
      [decision, actor, decision === "rejected" ? reason.trim() : null, orderId],
    );
    await db.query(
      "UPDATE orders SET status=$1,updated_at=now() WHERE id=$2",
      [decision === "paid" ? "paid" : "cancelled", orderId],
    );
    await audit(db, actor, `payment.manual-${decision}`, "orders", orderId, {
      method: order.payment_method,
    });
    return { ok: true };
  });
}
