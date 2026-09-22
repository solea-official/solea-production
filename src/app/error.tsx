"use client";
import { useStore } from "@/components/provider";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useStore();
  return (
    <section className="section wrap empty">
      <p className="eyebrow">SOLÉA</p>
      <h1>{t("A little pause.", "لحظة ونرجع.")}</h1>
      <p>
        {t(
          "Something went wrong. Please try again.",
          "حدث خطأ. يُرجى المحاولة مجددًا.",
        )}
      </p>
      <button className="button" onClick={reset}>
        {t("Try again", "إعادة المحاولة")}
      </button>
    </section>
  );
}
