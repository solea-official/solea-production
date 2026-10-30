import { config } from "./config";
export type RecoveryAudience = "customer" | "admin";
export type RecoveryLocale = "en" | "ar";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function recoveryEmail(
  audience: RecoveryAudience,
  raw: string,
  locale: RecoveryLocale,
) {
  const url = new URL(
    audience === "admin" ? "/ops-portal?reset=1" : "/account/reset",
    config().APP_URL,
  );
  // Fragment is never sent to Vercel, proxies or HTTP referrer headers. The page consumes it once.
  url.hash = `token=${raw}`;
  const ar = locale === "ar";
  const subject = ar
    ? "SOLÉA — إعادة تعيين كلمة المرور"
    : "SOLÉA — Reset Your Password";
  const lines = ar
    ? [
        "مرحبًا،",
        "تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك على SOLÉA.",
        "اضغط على الزر التالي لإنشاء كلمة مرور جديدة بشكل آمن.",
        "إعادة تعيين كلمة المرور",
        "حرصًا على أمان حسابك، فإن صلاحية هذا الرابط محدودة.",
        "إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة.",
        "فريق دعم SOLÉA",
      ]
    : [
        "Hello,",
        "We received a request to reset the password for your SOLÉA account.",
        "Click the button below to securely create a new password.",
        "Reset My Password",
        "For your security, this link is temporary.",
        "If you did not request a password reset, you can ignore this email.",
        "SOLÉA Support",
      ];
  const text = [
    ...lines.slice(0, 3),
    `${lines[3]}: ${url.href}`,
    ...lines.slice(4),
  ].join("\n\n");
  const html = `<!doctype html><html lang="${locale}" dir="${ar ? "rtl" : "ltr"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#FFFDF7;color:#4F5B2D;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:560px;background:white;border:1px solid #D8EDF2"><tr><td style="padding:32px;line-height:1.7;text-align:${ar ? "right" : "left"}"><p style="font-size:26px;letter-spacing:2px">SOLÉA</p>${lines
    .slice(0, 3)
    .map((s) => `<p>${escape(s)}</p>`)
    .join(
      "",
    )}<p style="margin:28px 0"><a href="${escape(url.href)}" style="display:inline-block;background:#4F5B2D;color:white;padding:14px 24px;text-decoration:none;border-radius:6px">${escape(lines[3])}</a></p>${lines
    .slice(4)
    .map((s) => `<p>${escape(s)}</p>`)
    .join("")}</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
