"use client";
import Link from "next/link";
import { useStore } from "@/components/provider";
export default function NotFound() {
  const { t } = useStore();
  return (
    <section className="section wrap empty">
      <p className="eyebrow">404 · SOLÉA</p>
      <h1>{t("Let’s find your way back.", "نرجع سوا للطريق الصحيح.")}</h1>
      <p>{t("This page could not be found.", "هذه الصفحة غير موجودة.")}</p>
      <Link className="button" href="/">
        {t("Home", "الرئيسية")}
      </Link>
    </section>
  );
}
