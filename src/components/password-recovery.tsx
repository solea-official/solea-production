"use client";
import { useEffect, useState } from "react";
import { useStore } from "./provider";

export const recoveryFeedback = [
  "If an account exists with this email address, you will receive password reset instructions shortly. Please check your inbox and spam folder.",
  "إذا كان هناك حساب مسجل بهذا البريد الإلكتروني، فستصلك تعليمات إعادة تعيين كلمة المرور. يُرجى مراجعة البريد الوارد والبريد غير المرغوب فيه.",
] as const;

// Keep the credential in component memory only, never local/session storage. Support previously issued query links.
export function useRecoveryToken(
  enabled: boolean,
  legacyParameter: "token" | "reset",
) {
  const [credential, setCredential] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const url = new URL(window.location.href);
    const raw =
      new URLSearchParams(url.hash.slice(1)).get("token") ||
      url.searchParams.get(legacyParameter) ||
      "";
    if (/^[a-f0-9]{64}$/.test(raw)) setCredential(raw);
    url.hash = "";
    if (legacyParameter === "reset") url.searchParams.set("reset", "1");
    else url.searchParams.delete("token");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
  }, [enabled, legacyParameter]);
  return { credential, clearCredential: () => setCredential("") };
}

export function NewPasswordFields() {
  const { t } = useStore();
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label>
        {t("New password", "كلمة المرور الجديدة")}
        <input
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={72}
          dir="ltr"
        />
      </label>
      <label>
        {t("Confirm new password", "تأكيد كلمة المرور الجديدة")}
        <input
          name="confirmPassword"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={72}
          dir="ltr"
        />
      </label>
      <button
        type="button"
        className="text-link"
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {t(
          visible ? "Hide password" : "Show password",
          visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور",
        )}
      </button>
      <p className="small">
        {t(
          "At least 12 characters, including uppercase, lowercase and a number. Maximum 72 bytes.",
          "12 حرفًا على الأقل، تشمل حرفًا إنجليزيًا كبيرًا وصغيرًا ورقمًا. الحد الأقصى 72 بايت.",
        )}
      </p>
    </>
  );
}
