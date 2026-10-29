"use client";
import { useEffect, useState } from "react";
import { ManualPaymentSteps } from "./manual-payment-steps";
import { api, currency, parseMoney } from "@/lib/api";
import { useStore, ErrorMessage } from "./provider";
import { Status, type OrderView } from "./checkout";

export function CopyValue({
  value,
  number = false,
}: {
  value: string;
  number?: boolean;
}) {
  const { t } = useStore();
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        type="button"
        className="copy-button"
        onClick={async () => {
          try {
            try {
              if (!navigator.clipboard?.writeText) throw new Error();
              await navigator.clipboard.writeText(value);
            } catch {
              const input = document.createElement("textarea");
              input.value = value;
              input.style.position = "fixed";
              input.style.opacity = "0";
              document.body.append(input);
              try {
                input.focus();
                input.select();
                input.setSelectionRange(0, value.length);
                if (!document.execCommand("copy")) throw new Error();
              } finally {
                input.remove();
              }
            }
            setMessage(
              number
                ? t(
                    "Phone number copied successfully.",
                    "تم نسخ رقم الهاتف بنجاح.",
                  )
                : t("Copied", "تم النسخ"),
            );
          } catch {
            setMessage(
              t(
                "Unable to copy automatically. Select and copy the displayed value.",
                "تعذّر النسخ تلقائيًا. حدّد القيمة المعروضة وانسخها.",
              ),
            );
          }
        }}
      >
        {number
          ? t("Copy Number", "نسخ الرقم")
          : t("Copy order ID", "نسخ رقم الطلب")}
      </button>
      <span role="status" className="small">
        {message}
      </span>
    </>
  );
}
export function ReceivingNumber({ method }: { method: string }) {
  const { data, t } = useStore();
  const value =
    method === "instapay"
      ? data.settings.instapay.account
      : data.settings.vodafoneCash.number;
  return (
    <div className="panel">
      <p>
        {method === "instapay" ? "InstaPay" : "Vodafone Cash"} ·{" "}
        {t("Receiving number", "رقم الاستلام")}
      </p>
      <div className="copy-row">
        <strong dir="ltr">{value}</strong>
        <CopyValue value={value} number />
      </div>
    </div>
  );
}
export function ManualPayment({
  order,
  onUpdated,
}: {
  order: OrderView;
  onUpdated: (o: OrderView) => void;
}) {
  const { t, data, locale, notify } = useStore();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [whatsapp, setWhatsapp] = useState("");
  useEffect(() => {
    let active = true;
    if (
      order.submitted_at &&
      order.payment_status === "awaiting_confirmation"
    ) {
      void api<{ url: string }>(
        `payment-whatsapp?orderId=${encodeURIComponent(order.id)}&locale=${locale}`,
      )
        .then((result) => {
          if (active) setWhatsapp(result.url);
        })
        .catch(() => {
          /* The existing retry button remains available. */
        });
    }
    return () => {
      active = false;
    };
  }, [order.id, order.submitted_at, order.payment_status, locale]);
  if (!["instapay", "vodafone_cash"].includes(order.payment_method))
    return null;
  const editable =
    order.status === "pending" &&
    (order.payment_status === "awaiting_confirmation" ||
      (order.payment_status === "rejected" && order.correction_allowed));
  const qr =
    order.payment_method === "instapay"
      ? data.settings.instapay.qrUrl
      : data.settings.vodafoneCash.qrUrl;
  const refresh = async () => {
    const next = await api<OrderView>(
      "order?id=" + encodeURIComponent(order.id),
    );
    onUpdated({ ...order, ...next });
  };
  return (
    <section
      className="payment-instructions"
      aria-labelledby="manual-payment-title"
    >
      <div className="payment-heading">
        <h2 id="manual-payment-title">
          {order.payment_method === "instapay" ? "InstaPay" : "Vodafone Cash"}
        </h2>
        <Status value={order.payment_status} />
      </div>
      {editable && (
        <>
          <p className="notice">
            {t(
              "This is a provisional order. Payment and the order are confirmed only after SOLÉA verifies receipt of the money.",
              "هذا طلب مبدئي. لا يُؤكَّد الدفع والطلب إلا بعد تحقق SOLÉA من استلام المبلغ.",
            )}
          </p>
          <ReceivingNumber method={order.payment_method} />
          {qr && (
            <div className="qr-shell">
              <img
                src={qr}
                width="280"
                height="280"
                alt={t("Payment QR code", "رمز QR للدفع")}
              />
            </div>
          )}
        </>
      )}
      <div className="total">
        <span>{t("Exact amount", "المبلغ المطلوب")}</span>
        <strong>{currency(order.total, locale)}</strong>
      </div>
      <div className="copy-row">
        <bdi>{order.reference}</bdi>
        <CopyValue value={order.reference} />
      </div>
      {editable && <ManualPaymentSteps />}
      {order.rejection_reason && (
        <p className="notice error">
          {t("Review result: ", "نتيجة المراجعة: ")}
          {order.rejection_reason}
        </p>
      )}
      {editable && (
        <div className="payment-submit-grid">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              setWhatsapp("");
              try {
                const form = new FormData(e.currentTarget);
                form.set("orderId", order.id);
                await api("payment-proof", "POST", form);
                await refresh();
                notify(
                  t(
                    "Payment screenshot uploaded successfully.",
                    "تم رفع صورة التحويل بنجاح.",
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t(
                "Payment screenshot (required)",
                "صورة تأكيد التحويل (مطلوبة)",
              )}
              <input
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                disabled={busy}
              />
            </label>
            <p className="small">
              {t(
                "PNG, JPEG or WebP. Maximum 4 MB. Stored privately.",
                "PNG أو JPEG أو WebP. الحد الأقصى 4 ميجابايت. تُحفظ الصورة بشكل خاص.",
              )}
            </p>
            <button className="button secondary" disabled={busy}>
              {order.proof_uploaded
                ? t("Replace screenshot", "استبدال الصورة")
                : t("Upload screenshot", "رفع الصورة")}
            </button>
            {order.proof_uploaded && (
              <p role="status">{t("Screenshot uploaded.", "تم رفع الصورة.")}</p>
            )}
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              setWhatsapp("");
              try {
                const f = new FormData(e.currentTarget);
                await api("payment-submission", "POST", {
                  orderId: order.id,
                  senderPhone: f.get("senderPhone"),
                  transferredAmount: parseMoney(String(f.get("amount"))),
                  reference: f.get("reference") || "",
                });
                await refresh();
                const result = await api<{ url: string }>(
                  `payment-whatsapp?orderId=${encodeURIComponent(order.id)}&locale=${locale}`,
                );
                setWhatsapp(result.url);
                notify(
                  t(
                    "Payment submitted for verification.",
                    "تم إرسال بيانات الدفع للمراجعة.",
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Sender phone number", "رقم هاتف المرسل")}
              <input
                name="senderPhone"
                type="tel"
                dir="ltr"
                pattern="01[0125][0-9]{8}"
                maxLength={11}
                required
                defaultValue={order.sender_phone || ""}
                placeholder="01xxxxxxxxx"
              />
            </label>
            <label>
              {t("Transferred amount (EGP)", "المبلغ المحوّل (جنيه مصري)")}
              <input
                name="amount"
                inputMode="decimal"
                dir="ltr"
                pattern="[0-9]+(\.[0-9]{1,2})?"
                required
                defaultValue={
                  order.transferred_amount
                    ? (order.transferred_amount / 100).toFixed(2)
                    : ""
                }
              />
            </label>
            <label>
              {t(
                "Transaction reference (if available)",
                "مرجع التحويل (إن توفر)",
              )}
              <input
                name="reference"
                maxLength={120}
                dir="ltr"
                defaultValue={order.transfer_reference || ""}
              />
            </label>
            <button className="button" disabled={busy || !order.proof_uploaded}>
              {busy
                ? t("Saving…", "جارٍ الحفظ…")
                : t("Submit payment details", "إرسال بيانات الدفع")}
            </button>
          </form>
        </div>
      )}
      {order.submitted_at &&
        order.payment_status === "awaiting_confirmation" && (
          <div className="panel">
            <p>
              {t(
                "Submitted for verification. Send the details and screenshot to SOLÉA on WhatsApp.",
                "تم الإرسال للمراجعة. أرسل البيانات وصورة التحويل إلى SOLÉA على واتساب.",
              )}
            </p>
            {whatsapp ? (
              <a
                className="button"
                href={whatsapp}
                target="_blank"
                rel="noreferrer"
              >
                {t(
                  "Send Payment Proof via WhatsApp",
                  "إرسال إثبات التحويل عبر واتساب",
                )}
              </a>
            ) : (
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api<{ url: string }>(
                      `payment-whatsapp?orderId=${encodeURIComponent(order.id)}&locale=${locale}`,
                    );
                    setWhatsapp(result.url);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Prepare WhatsApp confirmation", "تجهيز رسالة تأكيد واتساب")}
              </button>
            )}
            <p className="small">
              {t(
                "Attach the screenshot yourself. SOLÉA must check the conversation and the actual received funds before approval.",
                "أرفق الصورة بنفسك. يجب أن تراجع SOLÉA المحادثة والمبلغ المستلم فعليًا قبل الموافقة.",
              )}
            </p>
          </div>
        )}
      {order.payment_status === "rejected" && !order.correction_allowed && (
        <p>
          {t(
            "This order was rejected and closed. Contact SOLÉA before creating another order or sending another transfer.",
            "رُفض هذا الطلب وأُغلق. تواصل مع SOLÉA قبل إنشاء طلب آخر أو إجراء تحويل جديد.",
          )}
        </p>
      )}
      {error && <ErrorMessage code={error} />}
    </section>
  );
}
