import { audit, transaction } from "./db";
import { requireCondition } from "./config";

export function manualPaymentSettings() {
  const instaAccount = process.env.INSTAPAY_ACCOUNT?.trim() || "";
  const vodafoneNumber = process.env.VODAFONE_CASH_NUMBER?.trim() || "";
  const qr = process.env.INSTAPAY_QR_URL?.trim() || "";
  const vodafoneQr = process.env.VODAFONE_CASH_QR_URL?.trim() || "";
  return {
    instapay: {
      enabled:
        process.env.INSTAPAY_ENABLED === "true" &&
        process.env.INSTAPAY_RECIPIENT_VERIFIED === "true" &&
        !!instaAccount,
      account: instaAccount,
      qrUrl: /^https:\/\//.test(qr) ? qr : "",
    },
    vodafoneCash: {
      enabled:
        process.env.VODAFONE_CASH_ENABLED === "true" &&
        process.env.VODAFONE_CASH_RECIPIENT_VERIFIED === "true" &&
        !!vodafoneNumber,
      number: vodafoneNumber,
      qrUrl: /^https:\/\//.test(vodafoneQr) ? vodafoneQr : "",
    },
  };
}

export async function verifyManualPayment(
  actor: string,
  orderId: string,
  decision: "paid" | "rejected",
  reason = "",
  verification?: {
    submissionVersion: number;
    whatsappVerified?: boolean;
    receivedAmountVerified?: boolean;
    allowCorrection?: boolean;
  },
) {
  return transaction(async (db) => {
    const order = (
      await db.query(
        `SELECT o.*,p.status payment_status,p.submitted_at,p.proof_storage_path,p.transferred_amount,p.submission_version FROM orders o
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
    requireCondition(
      verification &&
        verification.submissionVersion === order.submission_version,
      409,
      "PAYMENT_REVIEW_CHANGED",
    );
    requireCondition(
      order.submitted_at &&
        order.proof_storage_path &&
        order.transferred_amount === order.total,
      409,
      "PAYMENT_SUBMISSION_REQUIRED",
    );
    if (decision === "paid")
      requireCondition(
        verification.whatsappVerified && verification.receivedAmountVerified,
        409,
        "PAYMENT_VERIFICATION_REQUIRED",
      );
    const correction =
      decision === "rejected" && verification.allowCorrection === true;
    if (decision === "rejected") {
      requireCondition(
        reason.trim().length > 0,
        400,
        "REJECTION_REASON_REQUIRED",
      );
      if (!correction && !order.stock_released) {
        const items = (
          await db.query(
            "SELECT product_id,quantity FROM order_items WHERE order_id=$1",
            [order.id],
          )
        ).rows;
        for (const item of items)
          await db.query(
            "UPDATE inventory SET stock=stock+$1 WHERE product_id=$2",
            [item.quantity, item.product_id],
          );
        await db.query("UPDATE orders SET stock_released=true WHERE id=$1", [
          order.id,
        ]);
      }
    }
    await db.query(
      `UPDATE payments SET status=$1,verified_by=$2,verified_at=now(),
       rejection_reason=$3,correction_allowed=$5,whatsapp_verified_at=CASE WHEN $1='paid' THEN now() ELSE NULL END,updated_at=now() WHERE order_id=$4`,
      [
        decision,
        actor,
        decision === "rejected" ? reason.trim() : null,
        orderId,
        correction,
      ],
    );
    await db.query("UPDATE orders SET status=$1,updated_at=now() WHERE id=$2", [
      decision === "paid" ? "paid" : correction ? "pending" : "cancelled",
      orderId,
    ]);
    await audit(db, actor, `payment.manual-${decision}`, "orders", orderId, {
      method: order.payment_method,
      submissionVersion: order.submission_version,
      correction,
      whatsappVerified: decision === "paid",
      reason: decision === "rejected" ? reason.trim() : undefined,
    });
    return { ok: true };
  });
}
