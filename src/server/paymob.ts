import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, requireCondition, config } from "./config";

const integrationIds = () =>
  (process.env.PAYMOB_INTEGRATION_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0);

export function paymobSettings() {
  const ids = integrationIds();
  const configured = Boolean(
    process.env.PAYMOB_SECRET_KEY &&
    process.env.PAYMOB_PUBLIC_KEY &&
    process.env.PAYMOB_HMAC_SECRET &&
    ids.length,
  );
  return {
    enabled: process.env.PAYMOB_ENABLED === "true" && configured,
    integrationIds: ids,
  };
}

type PaymobOrder = {
  id: string;
  reference: string;
  total: number;
  currency: "EGP";
  customer: {
    fullName: string;
    email: string;
    mobile: string;
    governorate: string;
    city: string;
    street: string;
    building: string;
    floor: string;
    apartment: string;
  };
  items: {
    name: string;
    description: string;
    amount: number;
    quantity: number;
  }[];
};

export async function createPaymobIntention(order: PaymobOrder) {
  const settings = paymobSettings();
  requireCondition(settings.enabled, 503, "INTEGRATION_NOT_CONFIGURED");
  requireCondition(
    Number.isSafeInteger(order.total) && order.total > 0,
    400,
    "INVALID_AMOUNT",
  );
  const endpoint = new URL(
    process.env.PAYMOB_API_URL || "https://accept.paymob.com/v1/intention/",
  );
  requireCondition(
    endpoint.protocol === "https:",
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  const names = order.customer.fullName.trim().split(/\s+/);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        amount: order.total,
        currency: order.currency,
        payment_methods: settings.integrationIds,
        items: order.items,
        billing_data: {
          first_name: names[0] || order.customer.fullName,
          last_name:
            names.slice(1).join(" ") || names[0] || order.customer.fullName,
          email: order.customer.email,
          phone_number: order.customer.mobile,
          state: order.customer.governorate,
          city: order.customer.city,
          street: order.customer.street,
          building: order.customer.building,
          floor: order.customer.floor,
          apartment: order.customer.apartment,
          country: "EG",
        },
        extras: { solea_order_id: order.id },
        special_reference: order.reference,
        expiration: 1800,
        notification_url: `${config().APP_URL}/api/webhooks/paymob`,
        redirection_url: `${config().APP_URL}/order-success`,
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new AppError(503, "PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) throw new AppError(503, "PROVIDER_UNAVAILABLE");
  const data = z
    .object({
      id: z.string().min(1).max(150),
      intention_order_id: z.union([
        z.number().int().positive(),
        z.string().min(1),
      ]),
      client_secret: z.string().min(20).max(4000),
    })
    .passthrough()
    .parse(await response.json());
  const checkout = new URL(
    process.env.PAYMOB_CHECKOUT_URL ||
      "https://accept.paymob.com/unifiedcheckout/",
  );
  requireCondition(checkout.protocol === "https:", 503, "INVALID_PROVIDER_URL");
  checkout.searchParams.set("publicKey", process.env.PAYMOB_PUBLIC_KEY!);
  checkout.searchParams.set("clientSecret", data.client_secret);
  return {
    providerId: data.id,
    providerOrderId: String(data.intention_order_id),
    checkoutUrl: checkout.toString(),
  };
}

const callbackSchema = z
  .object({
    type: z.literal("TRANSACTION"),
    obj: z
      .object({
        id: z.union([z.number().int().positive(), z.string().min(1)]),
        pending: z.boolean(),
        amount_cents: z.number().int().positive(),
        success: z.boolean(),
        is_auth: z.boolean(),
        is_capture: z.boolean(),
        is_standalone_payment: z.boolean(),
        is_voided: z.boolean(),
        is_refunded: z.boolean(),
        is_3d_secure: z.boolean(),
        integration_id: z.number().int().positive(),
        has_parent_transaction: z.boolean(),
        created_at: z.string().min(1).max(100),
        currency: z.literal("EGP"),
        error_occured: z.boolean(),
        owner: z.union([z.number(), z.string()]),
        source_data: z
          .object({
            pan: z.union([z.string(), z.number(), z.null()]).optional(),
            sub_type: z.union([z.string(), z.null()]).optional(),
            type: z.union([z.string(), z.null()]).optional(),
          })
          .passthrough(),
        order: z.union([
          z.number().int().positive(),
          z
            .object({
              id: z.union([z.number().int().positive(), z.string().min(1)]),
              merchant_order_id: z.union([z.string(), z.null()]).optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  })
  .passthrough();

export type PaymobCallback = z.infer<typeof callbackSchema>;

const scalar = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return typeof value === "boolean"
    ? String(value).toLowerCase()
    : String(value);
};

export function parseAndVerifyPaymobCallback(
  payload: unknown,
  signature: string | null,
) {
  const data = callbackSchema.parse(payload);
  const secret = process.env.PAYMOB_HMAC_SECRET;
  requireCondition(
    secret && secret.length >= 32,
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  requireCondition(
    signature && /^[a-f0-9]{128}$/i.test(signature),
    401,
    "INVALID_SIGNATURE",
  );
  const obj = data.obj;
  const orderId = typeof obj.order === "object" ? obj.order.id : obj.order;
  const values = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    orderId,
    obj.owner,
    obj.pending,
    obj.source_data.pan,
    obj.source_data.sub_type,
    obj.source_data.type,
    obj.success,
  ]
    .map(scalar)
    .join("");
  const expected = createHmac("sha512", secret).update(values).digest("hex");
  requireCondition(
    timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    ),
    401,
    "INVALID_SIGNATURE",
  );
  requireCondition(
    integrationIds().includes(obj.integration_id),
    409,
    "PROVIDER_MISMATCH",
  );
  return data;
}

export function paymobMerchantReference(data: PaymobCallback) {
  return typeof data.obj.order === "object"
    ? data.obj.order.merchant_order_id || ""
    : "";
}

export function paymobProviderOrderId(data: PaymobCallback) {
  return String(
    typeof data.obj.order === "object" ? data.obj.order.id : data.obj.order,
  );
}
