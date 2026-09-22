import { notFound } from "next/navigation";
import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  Catalog,
  ProductDetail,
  Ingredients,
  Information,
} from "@/components/storefront";
import {
  CartPage,
  Checkout,
  OrderSuccess,
  Tracking,
} from "@/components/checkout";
import { products } from "@/server/catalog";
import { storeData } from "@/server/store";
import { publicPages as pages } from "@/lib/routes";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const path = slug.join("/");
  const p =
    slug.length === 2 && slug[0] === "products"
      ? (await products()).find((p) => p.slug === slug[1])
      : undefined;
  if (!p && !pages[path]) notFound();
  return {
    title: p?.seo_title || p?.name_en || pages[path] || "Not found",
    description:
      p?.seo_description ||
      p?.description_en ||
      "SOLÉA — " + (pages[path] || "Page not found"),
    alternates: { canonical: "/" + path },
    robots: ["cart", "checkout", "order-success", "track-order"].includes(path)
      ? { index: false, follow: false }
      : undefined,
    openGraph: p
      ? {
          title: p.name_en,
          description: p.description_en,
          images: p.images[0] ? [p.images[0].url] : [],
        }
      : undefined,
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const path = slug.join("/"),
    data = await storeData();
  if (slug[0] === "products" && slug.length === 2) {
    const p = (await products()).find((x) => x.slug === slug[1]);
    if (!p) notFound();
    const structured = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name_en,
      description: p.description_en,
      sku: p.sku,
      brand: { "@type": "Brand", name: "SOLÉA" },
      image: p.images.map((i) => (process.env.APP_URL || "") + i.url),
      ...(p.price && data.settings.enabled
        ? {
            offers: {
              "@type": "Offer",
              price: (p.price / 100).toFixed(2),
              priceCurrency: "EGP",
              availability:
                p.stock > 0
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
              url: process.env.APP_URL + "/products/" + p.slug,
            },
          }
        : {}),
    };
    return (
      <>
        <script
          type="application/ld+json"
          nonce={(await headers()).get("x-nonce") || undefined}
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structured).replace(/</g, "\\u003c"),
          }}
        />
        <ProductDetail product={p} data={data} />
      </>
    );
  }
  if (!pages[path]) notFound();
  if (path === "products")
    return <Catalog products={await products()} data={data} />;
  if (path === "ingredients") return <Ingredients />;
  if (path === "cart") return <CartPage />;
  if (path === "checkout") return <Checkout data={data} />;
  if (path === "order-success")
    return (
      <Suspense>
        <OrderSuccess />
      </Suspense>
    );
  if (path === "track-order") return <Tracking />;
  return <Information page={path} data={data} />;
}
