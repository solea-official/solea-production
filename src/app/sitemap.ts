import type { MetadataRoute } from "next";
import { products } from "@/server/catalog";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    "",
    "/products",
    "/ingredients",
    "/about",
    "/contact",
    "/faq",
    "/shipping-policy",
    "/returns",
    "/privacy",
    "/terms",
    ...(await products()).map((p) => "/products/" + p.slug),
  ].map((p) => ({ url: process.env.APP_URL + p }));
}
