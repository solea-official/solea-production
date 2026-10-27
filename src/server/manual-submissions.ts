import { z } from "zod";
import { audit, pool, transaction } from "./db";
import { requireCondition } from "./config";
import { hash, type Session } from "./security";
import { uuid, phone } from "./validation";
import { uploadPaymentProof, removeStored } from "./storage";
import { releaseStock } from "./commerce";

const editable = `o.status='pending' AND NOT o.stock_released AND
 (p.status='awaiting_confirmation' OR (p.status='rejected' AND p.correction_allowed))`;
export const transferSchema = z
  .object({
    orderId: uuid,
    senderPhone: phone,
    transferredAmount: z.number().int().positive().max(2_000_000_000),
    reference: z.string().trim().max(120).default(""),
  })
  .strict();
async function requireEditable(s: Session, orderId: string) {
  requireCondition(
    (
      await pool.query(
        `SELECT 1 FROM orders o JOIN payments p ON p.order_id=o.id
 WHERE o.id=$1 AND (o.session_id=$2 OR o.account_id=$3) AND o.payment_method IN ('instapay','vodafone_cash') AND ${editable}`,
        [orderId, s.id, s.customer_account_id],
      )
    ).rowCount,
    404,
    "ORDER_NOT_FOUND",
  );
}
export async function saveProof(s: Session, orderId: string, file: File) {
  await requireEditable(s, orderId);
  const path = await uploadPaymentProof(orderId, file);
  let old: string | null = null;
  try {
    old = await transaction(async (db) => {
      const row = (
        await db.query(
          `SELECT p.proof_storage_path FROM payments p JOIN orders o ON o.id=p.order_id
   WHERE o.id=$1 AND (o.session_id=$2 OR o.account_id=$3) AND o.payment_method IN ('instapay','vodafone_cash') AND ${editable} FOR UPDATE OF o,p`,
          [orderId, s.id, s.customer_account_id],
        )
      ).rows[0];
      requireCondition(row, 404, "ORDER_NOT_FOUND");
      await db.query(
        "UPDATE payments SET proof_storage_path=$1,submitted_at=NULL,submission_version=submission_version+1,updated_at=now() WHERE order_id=$2",
        [path, orderId],
      );
      await audit(db, null, "payment.proof-uploaded", "orders", orderId);
      return row.proof_storage_path;
    });
  } catch (error) {
    await removeStored(path, true).catch(() => {});
    throw error;
  }
  // A cleanup failure must not report a committed upload as failed.
  if (old) await removeStored(old, true).catch(() => {});
  return { ok: true, proof_uploaded: true };
}
export async function submitTransfer(s: Session, input: unknown) {
  const data = transferSchema.parse(input);
  return transaction(async (db) => {
    const row = (
      await db.query(
        `SELECT o.total,o.payment_method,c.name,c.mobile,a.street,a.city,a.governorate,
   p.proof_storage_path,p.sender_phone,p.transferred_amount,p.transfer_reference,p.submitted_at
   FROM orders o JOIN payments p ON p.order_id=o.id JOIN customers c ON c.id=o.customer_id JOIN addresses a ON a.id=o.address_id
   WHERE o.id=$1 AND (o.session_id=$2 OR o.account_id=$3) AND o.payment_method IN ('instapay','vodafone_cash') AND ${editable} FOR UPDATE OF o,p`,
        [data.orderId, s.id, s.customer_account_id],
      )
    ).rows[0];
    requireCondition(row, 404, "ORDER_NOT_FOUND");
    requireCondition(
      row.name && row.mobile && row.street && row.city && row.governorate,
      409,
      "PROFILE_INCOMPLETE",
    );
    requireCondition(row.proof_storage_path, 409, "PAYMENT_PROOF_REQUIRED");
    requireCondition(
      data.transferredAmount === row.total,
      409,
      "TRANSFER_AMOUNT_MISMATCH",
    );
    if (
      row.submitted_at &&
      row.sender_phone === data.senderPhone &&
      row.transferred_amount === data.transferredAmount &&
      (row.transfer_reference || "") === data.reference
    )
      return { ok: true };
    if (data.reference) {
      const referenceHash = hash(data.reference.toUpperCase());
      await db.query(
        "INSERT INTO manual_transfer_references(method,reference_hash,order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [row.payment_method, referenceHash, data.orderId],
      );
      const bound = (
        await db.query(
          "SELECT order_id FROM manual_transfer_references WHERE method=$1 AND reference_hash=$2",
          [row.payment_method, referenceHash],
        )
      ).rows[0];
      requireCondition(
        bound?.order_id === data.orderId,
        409,
        "TRANSFER_REFERENCE_UNAVAILABLE",
      );
    }
    await db.query(
      `UPDATE payments SET sender_phone=$1,transferred_amount=$2,transfer_reference=$3,submitted_at=clock_timestamp(),
   status='awaiting_confirmation',correction_allowed=false,rejection_reason=NULL,verified_by=NULL,verified_at=NULL,
   submission_version=submission_version+1,updated_at=now() WHERE order_id=$4`,
      [
        data.senderPhone,
        data.transferredAmount,
        data.reference || null,
        data.orderId,
      ],
    );
    await audit(
      db,
      null,
      "payment.customer-submitted",
      "orders",
      data.orderId,
      { referenceProvided: !!data.reference },
    );
    return { ok: true };
  });
}
export async function whatsappLink(
  s: Session,
  orderId: string,
  locale: "en" | "ar",
) {
  const o = (
    await pool.query(
      `SELECT o.reference,o.total,o.payment_method,c.name,c.mobile,a.governorate,a.city,a.street,a.building,a.floor,a.apartment,
  p.sender_phone,p.transferred_amount,p.transfer_reference,p.submitted_at,p.proof_storage_path,p.status FROM orders o JOIN payments p ON p.order_id=o.id
  JOIN customers c ON c.id=o.customer_id JOIN addresses a ON a.id=o.address_id WHERE o.id=$1 AND (o.session_id=$2 OR o.account_id=$3)
  AND o.payment_method IN ('instapay','vodafone_cash')`,
      [orderId, s.id, s.customer_account_id],
    )
  ).rows[0];
  requireCondition(o, 404, "ORDER_NOT_FOUND");
  requireCondition(
    o.submitted_at &&
      o.proof_storage_path &&
      o.status === "awaiting_confirmation",
    409,
    "PAYMENT_SUBMISSION_REQUIRED",
  );
  const number = (
    await pool.query("SELECT phone FROM store_settings WHERE id=1")
  ).rows[0]?.phone;
  requireCondition(
    /^01[0125][0-9]{8}$/.test(number || ""),
    503,
    "WHATSAPP_NOT_CONFIGURED",
  );
  const address = [
    o.governorate,
    o.city,
    o.street,
    o.building,
    o.floor,
    o.apartment,
  ]
    .filter(Boolean)
    .join(", ");
  const method = o.payment_method === "instapay" ? "InstaPay" : "Vodafone Cash";
  const amount = (o.transferred_amount / 100).toFixed(2);
  const message =
    locale === "ar"
      ? `مرحبًا SOLÉA،\n\nأتممت تحويل مبلغ طلبي وأرغب في مراجعة الدفع.\n\nرقم الطلب: ${o.reference}\nاسم العميل: ${o.name}\nرقم الهاتف: ${o.mobile}\nطريقة الدفع: ${method}\nرقم هاتف المرسل: ${o.sender_phone}\nالمبلغ المحوّل: ${amount} EGP\nمرجع التحويل: ${o.transfer_reference || "غير متوفر"}\nعنوان الشحن: ${address}\n\nسأرفق صورة تأكيد التحويل في محادثة واتساب هذه.\nيرجى التحقق من استلام المبلغ وتأكيد طلبي.\nشكرًا.`
      : `Hello SOLÉA,\n\nI have completed the payment transfer for my order and would like to request payment verification.\n\nOrder Number: ${o.reference}\nCustomer Name: ${o.name}\nPhone Number: ${o.mobile}\nPayment Method: ${method}\nSender Phone Number: ${o.sender_phone}\nTransferred Amount: ${amount} EGP\nTransaction Reference: ${o.transfer_reference || "Not available"}\nShipping Address: ${address}\n\nI will attach my payment screenshot to this WhatsApp conversation.\n\nPlease verify my payment and confirm my order.\n\nThank you.`;
  return {
    url: `https://wa.me/20${number.slice(1)}?text=${encodeURIComponent(message)}`,
  };
}
export async function expireIncompleteManualPayments() {
  return transaction(async (db) => {
    const rows = (
      await db.query(`SELECT o.* FROM orders o JOIN payments p ON p.order_id=o.id
   WHERE o.payment_method IN ('instapay','vodafone_cash') AND o.status='pending' AND p.status='awaiting_confirmation'
   AND p.submitted_at IS NULL AND p.proof_storage_path IS NULL AND o.created_at<now()-interval '24 hours'
   ORDER BY o.id FOR UPDATE OF o,p SKIP LOCKED LIMIT 30`)
    ).rows;
    for (const order of rows) {
      await releaseStock(db, order);
      await db.query(
        "UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",
        [order.id],
      );
      await db.query(
        "UPDATE payments SET status='cancelled',updated_at=now() WHERE order_id=$1",
        [order.id],
      );
      await audit(db, null, "payment.incomplete-expired", "orders", order.id);
    }
    return rows.length;
  });
}
