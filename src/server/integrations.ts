import { z } from "zod";
import { AppError, requireCondition, config } from "./config";
import { smtpEmail } from "./email";
export async function adapter(
  service: "PAYMENT" | "BOSTA" | "EMAIL",
  path: string,
  payload: unknown,
  idempotencyKey: string,
) {
  const url = process.env[service + "_ADAPTER_URL"];
  const key = process.env[service + "_API_KEY"];
  requireCondition(url && key, 503, "INTEGRATION_NOT_CONFIGURED");
  const endpoint = new URL(url);
  requireCondition(
    endpoint.protocol === "https:",
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  let response: Response;
  try {
    response = await fetch(new URL(path, endpoint), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new AppError(503, "PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) throw new AppError(503, "PROVIDER_UNAVAILABLE");
  return response.json();
}
export async function createPayment(order: {
  id: string;
  total: number;
  currency: string;
}) {
  const result = z
    .object({ providerId: z.string().min(1).max(150), checkoutUrl: z.url() })
    .parse(
      await adapter(
        "PAYMENT",
        "checkout",
        {
          orderId: order.id,
          amount: order.total,
          currency: order.currency,
          returnUrl: config().APP_URL + "/order-success",
        },
        order.id,
      ),
    );
  const url = new URL(result.checkoutUrl);
  const allowed = (process.env.PAYMENT_HOSTED_ORIGINS || "")
    .split(",")
    .filter(Boolean);
  requireCondition(
    url.protocol === "https:" && allowed.includes(url.origin),
    503,
    "INVALID_PROVIDER_URL",
  );
  return result;
}
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  key: string,
  html?: string,
) {
  if (process.env.EMAIL_PROVIDER === "smtp") return smtpEmail(to, subject, body, key, html);
  requireCondition(process.env.EMAIL_FROM, 503, "INTEGRATION_NOT_CONFIGURED");
  return adapter(
    "EMAIL",
    "send",
    {
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text: body,
      ...(html ? { html } : {}),
      brand: "SOLÉA",
      logoUrl: config().APP_URL + "/media/logo.png",
    },
    key,
  );
}
