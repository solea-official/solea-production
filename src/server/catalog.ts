import { sql } from "drizzle-orm";
import { orm, pool } from "./db";
export type Product = {
  id: string;
  sku: string;
  slug: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  volume: string;
  category_id: string | null;
  price: number | null;
  status: string;
  stock: number;
  usage_en: string;
  usage_ar: string;
  warnings_en: string;
  warnings_ar: string;
  inci?: string;
  seo_title: string;
  seo_description: string;
  images: {
    id: string;
    url: string;
    alt_en: string;
    alt_ar: string;
    position: number;
  }[];
};
export async function products(all = false): Promise<Product[]> {
  const projection = all
    ? sql.raw("p.*")
    : sql.raw(`p.id,p.sku,p.slug,p.name_en,p.name_ar,p.description_en,
      p.description_ar,p.volume,p.category_id,p.price,p.status,p.usage_en,p.usage_ar,
      p.warnings_en,p.warnings_ar,p.seo_title,p.seo_description,p.created_at,p.updated_at`);
  const r = await orm.execute(
    sql`SELECT ${projection},i.stock,COALESCE((SELECT json_agg(pi ORDER BY pi.position,pi.id) FROM product_images pi WHERE pi.product_id=p.id),'[]') AS images FROM products p JOIN inventory i ON i.product_id=p.id WHERE (${all} OR p.status='active') ORDER BY p.created_at DESC LIMIT 1000`,
  );
  return r.rows as Product[];
}
export async function publicSettings() {
  const r = await pool.query(
    "SELECT enabled,cod_enabled,phone,instagram,shipping_zones,free_shipping_threshold FROM store_settings WHERE id=1",
  );
  const { manualPaymentSettings } = await import("./manual-payments");
  const { paymobSettings } = await import("./paymob");
  return {
    ...r.rows[0],
    ...manualPaymentSettings(),
    paymob: { enabled: paymobSettings().enabled },
  };
}
export async function content() {
  return (await pool.query("SELECT * FROM content ORDER BY key")).rows
    .filter(
      (x) =>
        x.published ||
        [
          "privacy",
          "terms",
          "returns",
          "shipping-policy",
          "distance-selling",
        ].includes(x.key),
    )
    .map((x) =>
      x.published
        ? x
        : {
            ...x,
            body_en:
              x.key === "returns"
                ? "Returns are accepted only if the product has not been opened. Full return and exchange terms will be published before launch."
                : "Full terms will be published before orders open.",
            body_ar:
              x.key === "returns"
                ? "يُقبل الإرجاع فقط إذا لم تُفتح العبوة. ستُنشر الشروط الكاملة للإرجاع والاستبدال قبل الإطلاق."
                : "ستُنشر الشروط الكاملة قبل إتاحة الطلبات.",
          },
    );
}
export const money = (value: number, locale = "en") =>
  new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
  }).format(value / 100);
