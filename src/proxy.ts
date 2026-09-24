import { NextRequest, NextResponse } from "next/server";
import { publicPages } from "./lib/routes";
import { pool } from "./server/db";
import { notFoundDocument } from "./server/not-found-document";
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const imageOrigins = [
    process.env.SUPABASE_URL,
    process.env.INSTAPAY_QR_URL,
    process.env.VODAFONE_CASH_QR_URL,
  ]
    .flatMap((value) => {
      try {
        const url = new URL(value || "");
        return url.protocol === "https:" ? [url.origin] : [];
      } catch {
        return [];
      }
    })
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(" ");
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${imageOrigins ? " " + imageOrigins : ""}; font-src 'self'; connect-src 'self'${dev ? " ws:" : ""}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';${dev ? "" : " upgrade-insecure-requests;"}`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const pathname = request.nextUrl.pathname.replace(/\/$/, "").slice(1);
  const internal =
    /^(?:api|ops-portal|media|_next|_not-found)(?:\/|$)/.test(pathname) ||
    ["robots.txt", "sitemap.xml", "favicon.ico"].includes(pathname);
  let missing = !internal && !Object.hasOwn(publicPages, pathname);
  if (/^products\/[^/]+$/.test(pathname)) {
    try {
      missing = !(
        await pool.query(
          "SELECT 1 FROM products WHERE slug=$1 AND status='active'",
          [pathname.slice(9)],
        )
      ).rowCount;
    } catch {
      missing = false;
    }
  }
  if (/^account\/orders\/[a-f0-9-]{36}$/.test(pathname)) missing = false;
  const response = missing
    ? new NextResponse(
        notFoundDocument(request.cookies.get("lang")?.value === "ar"),
        {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      )
    : NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (
    /^(?:ops-portal|account|checkout|order-success|track-order)(?:\/|$)/.test(
      pathname,
    )
  ) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "private, no-store");
  }
  if (!dev)
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
