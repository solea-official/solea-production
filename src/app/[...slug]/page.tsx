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
import { AccountAuth, AccountCenter } from "@/components/account";
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
  const accountOrder = /^account\/orders\/[a-f0-9-]{36}$/.test(path);
  if (!p && !pages[path] && !accountOrder) notFound();
  return {
    title: p?.seo_title || p?.name_en || pages[path] || (accountOrder ? "Order details" : "Not found"),
    description:
      p?.seo_description ||
      p?.description_en ||
      "SOLÉA — " + (pages[path] || "Page not found"),
    alternates: { canonical: "/" + path },
    robots: ["cart", "checkout", "order-success", "track-order"].includes(path) || path.startsWith("account")
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
  const accountOrder = slug.length === 3 && slug[0] === "account" && slug[1] === "orders" && /^[a-f0-9-]{36}$/.test(slug[2]);
  if (!pages[path] && !accountOrder) notFound();
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
  if (path === "account/login") return <AccountAuth mode="login" />;
  if (path === "account/register") return <AccountAuth mode="register" />;
  if (path === "account/forgot") return <AccountAuth mode="forgot" />;
  if (path === "account/reset") return <Suspense><AccountAuth mode="reset" /></Suspense>;
  if (path === "account") return <AccountCenter section="dashboard" />;
  if (path === "account/orders") return <AccountCenter section="orders" />;
  if (accountOrder) return <AccountCenter section="order" orderId={slug[2]} />;
  if (path === "account/addresses") return <AccountCenter section="addresses" />;
  if (path === "account/profile") return <AccountCenter section="profile" />;
  if (path === "account/security") return <AccountCenter section="security" />;
  return <Information page={path} data={data} />;
}
