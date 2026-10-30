import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { AppError, config, requireCondition } from "./config";

// Server-only configuration. No recipient-domain allowlist: the account email is authoritative.
export function emailConfiguration() {
  const provider = process.env.EMAIL_PROVIDER || "adapter";
  const from = process.env.EMAIL_FROM || "";
  requireCondition(
    from && !/[\r\n]/.test(from),
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  if (provider === "adapter") {
    let valid = false;
    try {
      valid =
        new URL(process.env.EMAIL_ADAPTER_URL || "").protocol === "https:";
    } catch {}
    requireCondition(
      valid && process.env.EMAIL_API_KEY,
      503,
      "INTEGRATION_NOT_CONFIGURED",
    );
    return { provider, from } as const;
  }
  requireCondition(provider === "smtp", 503, "INTEGRATION_NOT_CONFIGURED");
  const port = Number(process.env.SMTP_PORT || 465);
  requireCondition(
    process.env.EMAIL_DOMAIN_VERIFIED === "true" &&
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      [465, 2465, 587, 2587].includes(port),
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  return {
    provider: "smtp",
    from,
    options: {
      host: process.env.SMTP_HOST,
      port,
      secure: [465, 2465].includes(port),
      requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      logger: false,
      debug: false,
      pool: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    } satisfies SMTPTransport.Options,
  } as const;
}

export function requireRecoveryEmail() {
  try {
    requireCondition(
      process.env.EMAIL_ENABLED === "true",
      503,
      "EMAIL_UNAVAILABLE",
    );
    emailConfiguration();
    const url = new URL(config().APP_URL);
    requireCondition(
      !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/",
      503,
      "EMAIL_UNAVAILABLE",
    );
  } catch {
    // No addresses, credentials, provider response text or reset URLs in logs.
    console.error(JSON.stringify({ event: "email.configuration-unavailable" }));
    throw new AppError(503, "EMAIL_UNAVAILABLE");
  }
}

export function safeEmailFailure(error: unknown) {
  const e = error as { code?: string; responseCode?: number };
  const code = [
    "EAUTH",
    "ECONNECTION",
    "ETIMEDOUT",
    "ESOCKET",
    "EENVELOPE",
    "EMESSAGE",
    "PROVIDER_UNAVAILABLE",
    "INTEGRATION_NOT_CONFIGURED",
  ].includes(e?.code || "")
    ? e.code!
    : "EMAIL_DELIVERY_FAILED";
  const status = Number(e?.responseCode);
  return (
    code +
    (Number.isInteger(status) && status >= 400 && status <= 599
      ? `_${status}`
      : "")
  );
}

export async function smtpEmail(
  to: string,
  subject: string,
  text: string,
  key: string,
  html?: string,
) {
  const settings = emailConfiguration();
  requireCondition(
    settings.provider === "smtp",
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  const transport = nodemailer.createTransport(settings.options);
  try {
    const result = await transport.sendMail({
      from: settings.from,
      to,
      subject,
      text,
      html,
      headers: { "Resend-Idempotency-Key": key, "X-Entity-Ref-ID": key },
    });
    requireCondition(
      result.accepted?.length === 1 && !result.rejected?.length,
      503,
      "EMAIL_DELIVERY_FAILED",
    );
    // SMTP acceptance is not proof of delivery; inspect the provider's delivery/bounce events.
    return { accepted: true };
  } finally {
    transport.close();
  }
}

export async function verifyEmailTransport() {
  requireRecoveryEmail();
  const settings = emailConfiguration();
  requireCondition(
    settings.provider === "smtp",
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  const transport = nodemailer.createTransport(settings.options);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
