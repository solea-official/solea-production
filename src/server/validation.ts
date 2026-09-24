import { z } from "zod";
export const uuid = z.uuid();
const short = z.string().trim().min(1).max(150);
const text = z.string().trim().max(8000);
export const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const password = z
  .string()
  .min(12)
  .max(72)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/)
  .refine((v) => Buffer.byteLength(v, "utf8") <= 72);
export const phone = z.string().regex(/^01[0125][0-9]{8}$/);
export const loginSchema = z
  .object({
    email,
    password: z
      .string()
      .min(1)
      .max(72)
      .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
  })
  .strict();
export const productSchema = z
  .object({
    sku: short,
    slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name_en: short,
    name_ar: short,
    description_en: text,
    description_ar: text,
    volume: z.string().max(80),
    category_id: uuid.nullable(),
    price: z.number().int().min(1).max(100000000).nullable(),
    stock: z.number().int().min(0).max(1000000),
    status: z.enum(["active", "inactive", "archived"]),
    usage_en: text,
    usage_ar: text,
    warnings_en: text,
    warnings_ar: text,
    inci: text,
    seo_title: z.string().max(120),
    seo_description: z.string().max(300),
  })
  .strict();
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    cod_enabled: z.boolean(),
    phone,
    instagram: z.string().regex(/^[a-zA-Z0-9_.]{1,50}$/),
    shipping_zones: z
      .array(
        z
          .object({
            governorate: short,
            zone: z.string().trim().max(100),
            fee: z.number().int().min(0).max(1000000),
            active: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .refine((a) => new Set(a.map((x) => x.governorate)).size === a.length),
    free_shipping_threshold: z
      .number()
      .int()
      .positive()
      .max(100000000)
      .nullable(),
  })
  .strict();
export const checkoutSchema = z
  .object({
    idempotencyKey: uuid,
    fullName: short,
    mobile: phone,
    email,
    governorate: short,
    city: short,
    street: z.string().trim().min(3).max(300),
    building: z.string().max(60),
    floor: z.string().max(30),
    apartment: z.string().max(30),
    notes: z.string().max(1000),
    payment: z.enum(["cod", "paymob", "instapay", "vodafone_cash"]),
    transferReference: z.string().trim().max(120).default(""),
    savedAddressId: uuid.nullable().default(null),
    saveAddress: z.boolean().default(false),
    coupon: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9_-]*$/)
      .default(""),
    locale: z.enum(["ar", "en"]),
    acceptTerms: z.literal(true),
  })
  .strict();

export const customerPassword = z
  .string()
  .min(12)
  .max(72)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/)
  .refine((v) => Buffer.byteLength(v, "utf8") <= 72);

export const customerRegisterSchema = z
  .object({
    name: short,
    email,
    password: customerPassword,
    mobile: z.union([phone, z.literal("")]).default(""),
  })
  .strict();

export const customerLoginSchema = z
  .object({
    email,
    password: z
      .string()
      .min(1)
      .max(72)
      .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
  })
  .strict();

export const savedAddressSchema = z
  .object({
    label: z.string().trim().max(80).default(""),
    full_name: short,
    mobile: phone,
    governorate: short,
    city: short,
    street: z.string().trim().min(3).max(300),
    building: z.string().trim().max(60),
    floor: z.string().trim().max(30),
    apartment: z.string().trim().max(30),
    notes: z.string().trim().max(1000),
    is_default: z.boolean(),
  })
  .strict();
export const couponSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9_-]+$/),
    type: z.enum(["fixed", "percent"]),
    value: z.number().int().positive().max(100000000),
    active: z.boolean(),
    starts_at: z.iso.datetime().nullable(),
    ends_at: z.iso.datetime().nullable(),
    usage_limit: z.number().int().min(1).max(1000000),
    minimum: z.number().int().min(0).max(100000000),
  })
  .strict()
  .refine((v) => v.type !== "percent" || v.value <= 10000)
  .refine((v) => !v.starts_at || !v.ends_at || v.starts_at < v.ends_at);
export const contentSchema = z
  .object({
    key: z
      .string()
      .max(80)
      .regex(/^[a-z0-9-]+$/),
    title_en: z.string().max(200),
    title_ar: z.string().max(200),
    body_en: text,
    body_ar: text,
    published: z.boolean(),
  })
  .strict();
export const webhookSchema = z
  .object({
    eventId: z.string().min(1).max(150),
    orderId: uuid,
    providerId: z.string().min(1).max(150),
    status: z.enum(["paid", "failed", "refunded"]),
    amount: z.number().int().positive(),
    currency: z.literal("EGP"),
  })
  .strict();
export const shippingWebhookSchema = z
  .object({
    eventId: z.string().min(1).max(150),
    orderId: uuid,
    providerId: z.string().min(1).max(150),
    status: z.enum(["shipped", "delivered"]),
    trackingId: z.string().min(1).max(150),
  })
  .strict();
