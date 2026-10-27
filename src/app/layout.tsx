import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Shell } from "@/components/provider";
import { storeData } from "@/server/store";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: {
    default: "SOLÉA — Gentle care for little beginnings",
    template: "%s | SOLÉA",
  },
  description:
    "SOLÉA baby care. Botanical inspiration and thoughtful formulation.",
  icons: { icon: "/media/logo.png" },
  openGraph: {
    title: "SOLÉA",
    description: "Gentle care for little beginnings.",
    images: ["/media/product-main-v2.webp"],
    type: "website",
  },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = (await cookies()).get("lang")?.value === "ar" ? "ar" : "en";
  const data = await storeData();
  const nonce = (await headers()).get("x-nonce") || undefined;
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "SOLÉA",
    url: process.env.APP_URL,
    logo: (process.env.APP_URL || "") + "/media/logo.png",
    telephone: "+20" + data.settings.phone.slice(1),
    sameAs: ["https://instagram.com/" + data.settings.instagram],
  };
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body>
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(org).replace(/</g, "\\u003c"),
          }}
        />
        <Shell locale={lang} data={data}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
