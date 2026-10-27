"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore, ErrorMessage } from "./provider";
type Reporting = {
  current: { period_id: string | null; starts_at: string | null };
  periods: { id: string; starts_at: string }[];
  backups: { id: string; label: string; created_at: string }[];
};
export function ReportingControls({ onChanged }: { onChanged: () => void }) {
  const { t, locale } = useStore();
  const [state, setState] = useState<Reporting | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Reporting>("admin/reporting")
      .then(setState)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function change(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("admin/reporting", "POST", body);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel">
      <summary>{t("Reporting period", "فترة التقارير")}</summary>
      {state && (
        <>
          <p>
            {state.current.starts_at
              ? new Date(state.current.starts_at).toLocaleString(locale)
              : t("All history", "كل السجلات")}
          </p>
          <p>
            {t(
              "A reset changes the reporting baseline only. Historical orders, payments, customers and stock remain intact. A verified backup from the operator is required.",
              "إعادة الضبط تغيّر بداية فترة التقارير فقط. تبقى الطلبات والمدفوعات والعملاء والمخزون محفوظة. يلزم إنشاء نسخة احتياطية موثقة بواسطة المشغّل.",
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void change({
                action: "reset",
                backupId: f.get("backupId"),
                expectedPeriodId: state.current.period_id,
                confirmation: f.get("confirmation"),
              });
            }}
          >
            <label>
              {t("Verified backup", "النسخة الاحتياطية الموثقة")}
              <select name="backupId" required>
                <option value="">
                  {t("Select backup", "اختر نسخة احتياطية")}
                </option>
                {state.backups.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.label} · {new Date(b.created_at).toLocaleString(locale)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(
                "Type RESET to start a new period",
                "اكتب RESET لبدء فترة جديدة",
              )}
              <input
                name="confirmation"
                pattern="RESET"
                required
                autoComplete="off"
              />
            </label>
            <button className="button" disabled={busy || !state.backups.length}>
              {t("Start new reporting period", "بدء فترة تقارير جديدة")}
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const id = String(new FormData(e.currentTarget).get("periodId"));
              void change({
                action: "restore",
                periodId: id || null,
                expectedPeriodId: state.current.period_id,
              });
            }}
          >
            <label>
              {t("Restore reporting view", "استعادة عرض التقارير")}
              <select name="periodId">
                <option value="">{t("All history", "كل السجلات")}</option>
                {state.periods.map((p) => (
                  <option value={p.id} key={p.id}>
                    {new Date(p.starts_at).toLocaleString(locale)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary" disabled={busy}>
              {t("Restore selected period", "استعادة الفترة المختارة")}
            </button>
          </form>
        </>
      )}
      {error && <ErrorMessage code={error} />}
    </details>
  );
}
