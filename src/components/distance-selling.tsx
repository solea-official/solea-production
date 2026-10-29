"use client";
import Link from "next/link";
import { useStore } from "./provider";
import type { Content } from "@/lib/types";
export function DistanceSelling({
  entry,
  showMethods = true,
}: {
  entry?: Content;
  showMethods?: boolean;
}) {
  const { t, locale, data } = useStore();
  const methods = [
    data.settings.cod_enabled && t("Cash on Delivery", "الدفع عند الاستلام"),
    data.settings.paymob?.enabled &&
      t("Paymob online payment", "الدفع الإلكتروني عبر Paymob"),
    data.settings.instapay?.enabled && "InstaPay",
    data.settings.vodafoneCash?.enabled && "Vodafone Cash",
  ].filter(Boolean);
  const body = t(entry?.body_en || "", entry?.body_ar || "");
  return (
    <div
      className="distance-selling-content"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      {entry?.published ? (
        body
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map((block, i) =>
            /^\d+\.\s/.test(block) ? (
              <h2 key={i}>{block}</h2>
            ) : (
              <p key={i}>{block}</p>
            ),
          )
      ) : (
        <p>
          {t(
            "Final Distance Selling terms are awaiting business and legal approval. The current checkout displays the applicable total, delivery options and enabled payment methods. A manual transfer remains unconfirmed until SOLÉA verifies the received funds. Contact us for help with an order.",
            "شروط البيع عن بُعد النهائية بانتظار اعتماد الشركة والمراجعة القانونية. تعرض صفحة إتمام الشراء الإجمالي وخيارات التوصيل وطرق الدفع المفعّلة. يظل التحويل اليدوي غير مؤكد حتى تتحقق SOLÉA من استلام المبلغ. تواصل معنا للمساعدة بشأن طلبك.",
          )}
        </p>
      )}
      {showMethods && methods.length > 0 && (
        <p className="available-payment-methods">
          {t(
            "Currently enabled payment methods: ",
            "طرق الدفع المفعّلة حاليًا: ",
          )}
          {methods.join(" · ")}
        </p>
      )}
      <p>
        <Link href="/shipping-policy">
          {t("Shipping Policy", "سياسة الشحن")}
        </Link>{" "}
        ·{" "}
        <Link href="/returns">
          {t("Returns and refunds", "الإرجاع واسترداد المبالغ")}
        </Link>{" "}
        · <Link href="/privacy">{t("Privacy Policy", "سياسة الخصوصية")}</Link>
      </p>
      <div className="actions">
        <a href={"tel:+20" + data.settings.phone.slice(1)}>
          {t("Call SOLÉA", "اتصل بـ SOLÉA")} <bdi>{data.settings.phone}</bdi>
        </a>
        <a
          href={"https://wa.me/20" + data.settings.phone.slice(1)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("WhatsApp support", "الدعم عبر واتساب")}
        </a>
      </div>
    </div>
  );
}
