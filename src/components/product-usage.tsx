"use client";
import { useStore } from "./provider";
// Database content remains editable; the migration/seed supplies the approved four blocks.
export function ProductUsage({ en, ar }: { en: string; ar: string }) {
  const { t, locale } = useStore();
  const blocks = t(en, ar)
    .split(/\n\s*\n/)
    .filter(Boolean);
  const structured =
    blocks.length === 4 &&
    /^(DIRECTIONS FOR USE|طريقة الاستخدام)/.test(blocks[0]);
  return (
    <details className="product-usage" dir={locale === "ar" ? "rtl" : "ltr"}>
      <summary>
        {structured ? blocks[0] : t("How to use", "طريقة الاستخدام")}
      </summary>
      {structured ? (
        <>
          <p>{blocks[1]}</p>
          <h3>{blocks[2]}</h3>
          <p>{blocks[3]}</p>
        </>
      ) : (
        <p className="prose">{t(en, ar)}</p>
      )}
    </details>
  );
}
