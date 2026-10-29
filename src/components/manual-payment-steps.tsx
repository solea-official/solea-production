"use client";
import { useStore } from "./provider";
export function ManualPaymentSteps() {
  const { t } = useStore();
  return (
    <div className="manual-payment-steps">
      <h3>{t("Complete Your Payment", "إتمام الدفع")}</h3>
      <ol className="payment-steps">
        {[
          [
            "Transfer the displayed order amount using InstaPay or Vodafone Cash.",
            "حوّل قيمة الطلب الموضحة باستخدام إنستا باي أو فودافون كاش.",
          ],
          [
            "Take a clear screenshot of the successful transaction.",
            "احتفظ بصورة واضحة لإيصال التحويل الناجح.",
          ],
          [
            "Prepare your full name and the phone number used to send the transfer.",
            "جهّز اسمك بالكامل ورقم الهاتف الذي تم التحويل منه.",
          ],
          [
            "Upload the payment screenshot in the required field.",
            "ارفع صورة إثبات التحويل في المكان المخصص.",
          ],
          [
            "Click the WhatsApp button below.",
            "اضغط على زر واتساب الموجود بالأسفل.",
          ],
          [
            "Send your name, sender phone number, order details, and payment screenshot to SOLÉA.",
            "أرسل اسمك ورقم التحويل وبيانات الطلب وصورة إيصال التحويل إلى SOLÉA.",
          ],
        ].map(([en, ar]) => (
          <li key={en}>{t(en, ar)}</li>
        ))}
      </ol>
      <p className="notice">
        <strong>{t("Important: ", "مهم: ")}</strong>
        {t(
          "Your payment will be reviewed before your order is confirmed.",
          "سيتم مراجعة التحويل والتأكد من استلام المبلغ قبل تأكيد طلبك.",
        )}
      </p>
    </div>
  );
}
