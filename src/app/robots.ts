import type { MetadataRoute } from "next";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/cart",
        "/checkout",
        "/order-success",
        "/track-order",
      ],
    },
    sitemap: process.env.APP_URL + "/sitemap.xml",
  };
}
