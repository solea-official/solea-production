let csrfToken = "";
let pending: Promise<void> | undefined;
async function bootstrap() {
  if (csrfToken) return;
  if (!pending)
    pending = fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("CONNECTION_ERROR");
        csrfToken = (await r.json()).csrf;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}
export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  await bootstrap();
  const file = body instanceof FormData;
  const res = await fetch("/api/" + url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(method === "GET" ? {} : { "x-csrf-token": csrfToken }),
      ...(!file && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : file ? body : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) csrfToken = "";
    throw new Error(data.error || "CONNECTION_ERROR");
  }
  if (data.csrf) csrfToken = data.csrf;
  return data as T;
}
export function analytics(
  event:
    | "view_product"
    | "add_to_cart"
    | "remove_from_cart"
    | "begin_checkout"
    | "purchase"
    | "contact"
    | "whatsapp_click",
  productId?: string,
) {
  if (localStorage.getItem("analytics-consent") !== "yes") return;
  window.dispatchEvent(
    new CustomEvent("solea:analytics", {
      detail: { event, ...(productId ? { productId } : {}) },
    }),
  );
}
export function currency(value: number, locale = "en") {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
  }).format(value / 100);
}
export function parseMoney(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw new Error("INVALID_INPUT");
  const [whole, cents = ""] = value.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}
