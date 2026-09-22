"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, currency, analytics } from "@/lib/api";
import { Cart, StoreData } from "@/lib/types";
import { useStore, ErrorMessage } from "./provider";
import { PageTitle } from "./storefront";
import { Icon } from "./brand";
export function CartPage() {
  const { t, locale } = useStore();
  const [cart, setCart] = useState<Cart | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Cart>("cart")
      .then(setCart)
      .catch((e) => setError(e.message));
  }, []);
  async function update(id: string, quantity: number) {
    setBusy(true);
    setError("");
    try {
      setCart(await api<Cart>("cart", "PUT", { productId: id, quantity }));
      if (!quantity) analytics("remove_from_cart", id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={t("Your little essentials.", "احتياجات صغيرك.")}
        eyebrow={t("Shopping bag", "سلة التسوّق")}
      />
      <section className="section compact wrap">
        {error && <ErrorMessage code={error} />}{" "}
        {!cart && !error && (
          <p role="status">{t("Loading your bag…", "جارٍ تحميل السلة…")}</p>
        )}
        {cart &&
          (cart.items.length ? (
            <div className="checkout-grid">
              <div>
                {cart.items.map((item) => (
                  <article className="cart-item" key={item.id}>
                    <Link href={"/products/" + item.slug}>
                      <img
                        src={item.image || "/media/logo.png"}
                        alt={t(item.name_en, item.name_ar)}
                        width="150"
                        height="150"
                      />
                    </Link>
                    <div>
                      <h3>{t(item.name_en, item.name_ar)}</h3>
                      <p>{item.volume}</p>
                      <p>
                        {item.price === null
                          ? t("Price Coming Soon", "السعر يُعلن قريبًا")
                          : currency(item.price, locale)}
                      </p>
                      <div className="quantity">
                        <button
                          disabled={busy || item.quantity === 1}
                          onClick={() => update(item.id, item.quantity - 1)}
                          aria-label={t("Decrease quantity", "تقليل الكمية")}
                        >
                          −
                        </button>
                        <output>{item.quantity}</output>
                        <button
                          disabled={
                            busy || item.quantity >= Math.min(item.stock, 99)
                          }
                          onClick={() => update(item.id, item.quantity + 1)}
                          aria-label={t("Increase quantity", "زيادة الكمية")}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="text-link remove"
                        disabled={busy}
                        onClick={() => update(item.id, 0)}
                      >
                        {t("Remove", "إزالة")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <aside className="summary-card">
                <h2>{t("Your bag", "سلّتك")}</h2>
                <div className="total">
                  <span>{t("Subtotal", "المجموع الفرعي")}</span>
                  <strong>{currency(cart.subtotal, locale)}</strong>
                </div>
                <p>
                  {t(
                    "Select your delivery location at checkout.",
                    "اختاري عنوان التوصيل عند إتمام الطلب.",
                  )}
                </p>
                {cart.valid ? (
                  <Link className="button full" href="/checkout">
                    {t("Continue to checkout", "متابعة إتمام الطلب")}
                    <Icon />
                  </Link>
                ) : (
                  <p className="notice">
                    {t(
                      "Some items are no longer available. Please update your bag.",
                      "بعض المنتجات لم تعد متاحة. يُرجى تحديث السلة.",
                    )}
                  </p>
                )}
              </aside>
            </div>
          ) : (
            <div className="empty">
              <Icon name="bag" />
              <h2>{t("A little room for care.", "مكان صغير للعناية.")}</h2>
              <p>{t("Your bag is empty.", "سلّتك فارغة.")}</p>
              <Link className="button" href="/products">
                {t("Explore the collection", "اكتشفي المجموعة")}
              </Link>
            </div>
          ))}
      </section>
    </>
  );
}
export function Checkout({ data }: { data: StoreData }) {
  const { t, locale } = useStore();
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [method, setMethod] = useState("cod"),
    [governorate, setGovernorate] = useState(""),
    [coupon, setCoupon] = useState(""),
    [estimate, setEstimate] = useState<{
      subtotal: number;
      shipping: number;
      discount: number;
      total: number;
    } | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  useEffect(() => {
    api<Cart>("cart")
      .then(setCart)
      .catch((e) => setError(e.message));
    analytics("begin_checkout");
  }, []);
  useEffect(() => {
    setEstimate(null);
    if (!governorate) return;
    let alive = true;
    const timer = setTimeout(() => {
      api<typeof estimate>("quote", "POST", { governorate, coupon })
        .then((v) => {
          if (alive) {
            setEstimate(v);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [governorate, coupon]);
  const ready =
    data.settings.enabled &&
    data.content.filter(
      (c) =>
        ["terms", "privacy", "shipping-policy", "returns"].includes(c.key) &&
        c.published,
    ).length === 4;
  return (
    <>
      <PageTitle
        title={t("A little closer.", "خطوة أقرب.")}
        eyebrow={t("Checkout", "إتمام الطلب")}
      />
      <section className="section compact wrap">
        {error && <ErrorMessage code={error} />}{" "}
        {!ready ? (
          <div className="empty">
            <h2>{t("Our first chapter is coming soon.", "بدايتنا تقترب.")}</h2>
            <p>
              {t(
                "Orders will open once pricing, availability and delivery details are confirmed.",
                "ستُتاح الطلبات بعد تأكيد السعر والتوفّر وتفاصيل التوصيل.",
              )}
            </p>
            <Link href="/products" className="button">
              {t("Explore products", "اكتشفي المنتجات")}
            </Link>
          </div>
        ) : cart?.valid ? (
          <form
            className="checkout-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const fields = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                const res = await api<{ id: string }>("checkout", "POST", {
                  ...fields,
                  payment: method,
                  coupon,
                  locale,
                  governorate,
                  acceptTerms: fields.acceptTerms === "on",
                  idempotencyKey: key,
                });
                sessionStorage.setItem("last-order", res.id);
                router.push("/order-success?id=" + res.id);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            <div>
              <h2>{t("Your details", "بياناتك")}</h2>
              <div className="fields">
                {[
                  ["fullName", "Full name", "الاسم الكامل", "text", "name"],
                  ["mobile", "Mobile number", "رقم الموبايل", "tel", "tel"],
                  ["email", "Email", "البريد الإلكتروني", "email", "email"],
                ].map(([name, en, ar, type, auto]) => (
                  <label key={name}>
                    {t(en, ar)}
                    <input
                      name={name}
                      type={type}
                      autoComplete={auto}
                      required
                      maxLength={name === "email" ? 254 : 150}
                      pattern={
                        name === "mobile" ? "01[0125][0-9]{8}" : undefined
                      }
                      dir={type === "text" ? undefined : "ltr"}
                    />
                  </label>
                ))}
                <label>
                  {t("Governorate", "المحافظة")}
                  <select
                    name="governorate"
                    value={governorate}
                    onChange={(e) => setGovernorate(e.target.value)}
                    required
                  >
                    <option value="">
                      {t("Select your delivery area", "اختاري منطقة التوصيل")}
                    </option>
                    {data.settings.shipping_zones.filter((r) => r.active).map((r) => (
                      <option key={r.governorate} value={r.governorate}>
                        {r.governorate}{r.zone ? ` · ${r.zone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {[
                  ["city", "City", "المدينة"],
                  ["street", "Street address", "عنوان الشارع"],
                  ["building", "Building", "المبنى"],
                  ["floor", "Floor", "الدور"],
                  ["apartment", "Apartment", "الشقة"],
                ].map(([name, en, ar]) => (
                  <label key={name}>
                    {t(en, ar)}
                    <input
                      name={name}
                      required={name === "city" || name === "street"}
                      maxLength={
                        name === "street" ? 300 : name === "city" ? 150 : 30
                      }
                    />
                  </label>
                ))}
                <label className="span-2">
                  {t("Order notes", "ملاحظات الطلب")}
                  <textarea name="notes" maxLength={1000} />
                </label>
              </div>
              <h2>{t("Payment", "الدفع")}</h2>
              <label className="payment">
                <input
                  type="radio"
                  checked={method === "cod"}
                  onChange={() => setMethod("cod")}
                  disabled={!data.settings.cod_enabled}
                />
                {t("Cash on Delivery", "الدفع عند الاستلام")}
              </label>
              <label className="payment">
                <input type="radio" checked={method === "instapay"} onChange={() => setMethod("instapay")} disabled={!data.settings.instapay.enabled} />
                InstaPay
              </label>
              <label className="payment">
                <input type="radio" checked={method === "vodafone_cash"} onChange={() => setMethod("vodafone_cash")} disabled={!data.settings.vodafoneCash.enabled} />
                Vodafone Cash
              </label>
              {method !== "cod" && (
                <>
                  <p className="notice">
                    {t(
                      "Your order will await admin confirmation after transfer. Only SOLÉA administrators can mark it paid.",
                      "سيظل الطلب بانتظار مراجعة التحويل. مسؤولو SOLÉA فقط يمكنهم تأكيد الدفع.",
                    )}
                  </p>
                  <label>
                    {t("Transfer reference (optional)", "مرجع التحويل (اختياري)")}
                    <input name="transferReference" maxLength={120} dir="ltr" />
                  </label>
                </>
              )}
              <label className="check">
                <input name="acceptTerms" type="checkbox" required />
                {t("I agree to the", "أوافق على")}{" "}
                <Link href="/terms" target="_blank">
                  {t("terms", "الشروط والأحكام")}
                </Link>{" "}
                {t("and have read the", "وقرأت")}{" "}
                <Link href="/privacy" target="_blank">
                  {t("privacy policy.", "سياسة الخصوصية.")}
                </Link>
              </label>
            </div>
            <aside className="summary-card">
              <h2>{t("Your order", "طلبك")}</h2>
              {cart.items.map((i) => (
                <div className="total" key={i.id}>
                  <span>
                    {t(i.name_en, i.name_ar)} × {i.quantity}
                  </span>
                  <span>{currency((i.price || 0) * i.quantity, locale)}</span>
                </div>
              ))}
              <label>
                {t("Promo code", "رمز الخصم")}
                <input
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  maxLength={40}
                />
              </label>
              {estimate &&
                [
                  ["Subtotal", "المجموع الفرعي", estimate.subtotal],
                  ["Discount", "الخصم", -estimate.discount],
                  ["Shipping", "الشحن", estimate.shipping],
                  ["Total", "الإجمالي", estimate.total],
                ].map(([en, ar, v]) => (
                  <div className="total" key={en}>
                    <span>{t(en as string, ar as string)}</span>
                    <strong>{currency(v as number, locale)}</strong>
                  </div>
                ))}
              <p className="small">
                {t("Shipping configured for the selected area", "الشحن حسب المنطقة المختارة")}
              </p>
              <button
                className="button full"
                disabled={
                  busy ||
                  !estimate ||
                  (method === "cod"
                    ? !data.settings.cod_enabled
                    : method === "instapay"
                      ? !data.settings.instapay.enabled
                      : !data.settings.vodafoneCash.enabled)
                }
              >
                {busy
                  ? t("Placing your order…", "جارٍ تسجيل الطلب…")
                  : t("Place order", "تأكيد الطلب")}
                <Icon />
              </button>
            </aside>
          </form>
        ) : (
          <div className="empty">
            <p>
              {t(
                "Your bag needs available items before checkout.",
                "أضيفي منتجات متاحة إلى السلة قبل إتمام الطلب.",
              )}
            </p>
            <Link href="/cart" className="button">
              {t("Back to bag", "العودة إلى السلة")}
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
type OrderView = {
  id: string;
  reference: string;
  status: string;
  payment_status: string;
  payment_method: string;
  transfer_reference: string | null;
  proof_uploaded: boolean;
  total: number;
  trackingToken: string;
  items: { name_en: string; name_ar: string; quantity: number }[];
};
export function OrderSuccess() {
  const { t, locale, data } = useStore();
  const query = useSearchParams();
  const [order, setOrder] = useState<OrderView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = query.get("id") || sessionStorage.getItem("last-order");
    if (!id) {
      setError("ORDER_NOT_FOUND");
      return;
    }
    api<OrderView>("order?id=" + encodeURIComponent(id))
      .then((o) => {
        setOrder(o);
        if (o.payment_status === "paid" || o.payment_method === "cod")
          analytics("purchase");
      })
      .catch((e) => setError(e.message));
  }, [query]);
  return (
    <>
      <PageTitle
        title={t("Your order, received.", "استلمنا طلبك.")}
        eyebrow="SOLÉA"
      />
      <section className="section compact wrap narrow">
        {error && <ErrorMessage code={error} />}{" "}
        {order && (
          <div className="summary-card">
            <h2>
              <bdi>{order.reference}</bdi>
            </h2>
            <p>
              {t("Status", "الحالة")}: <Status value={order.status} />
            </p>
            <p>
              {t("Payment", "الدفع")}: <Status value={order.payment_status} />
            </p>
            {order.items.map((i, n) => (
              <p key={n}>
                {t(i.name_en, i.name_ar)} × {i.quantity}
              </p>
            ))}
            <div className="total">
              <strong>{t("Total", "الإجمالي")}</strong>
              <strong>{currency(order.total, locale)}</strong>
            </div>
            <p>
              {t(
                "Keep this private tracking key to check delivery.",
                "احتفظي بمفتاح التتبّع الخاص لمعرفة حالة التوصيل.",
              )}
            </p>
            <code className="tracking-key" dir="ltr">
              {order.trackingToken}
            </code>
            <Link className="text-link" href="/track-order">
              {t("Track your order", "تتبّعي طلبك")}
            </Link>
            {["instapay", "vodafone_cash"].includes(order.payment_method) &&
              order.payment_status === "awaiting_confirmation" &&
              order.status === "pending" && (
                <div className="panel">
                  <h3>{order.payment_method === "instapay" ? "InstaPay" : "Vodafone Cash"}</h3>
                  <p dir="ltr">
                    {order.payment_method === "instapay"
                      ? data.settings.instapay.account
                      : data.settings.vodafoneCash.number}
                  </p>
                  {order.payment_method === "instapay" && data.settings.instapay.qrUrl && (
                    <img src={data.settings.instapay.qrUrl} alt="InstaPay QR" width="220" height="220" />
                  )}
                  <p>{t("Upload a transfer proof if available.", "يمكنكِ رفع صورة إيصال التحويل إن وُجدت.")}</p>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      const form = new FormData(e.currentTarget);
                      form.set("orderId", order.id);
                      await api("payment-proof", "POST", form);
                      setOrder({ ...order, proof_uploaded: true });
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}>
                    <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
                    <button className="button full" disabled={busy}>
                      {order.proof_uploaded ? t("Replace proof", "استبدال الإيصال") : t("Upload proof", "رفع الإيصال")}
                    </button>
                  </form>
                </div>
              )}
          </div>
        )}
      </section>
    </>
  );
}
export function Status({ value }: { value: string }) {
  const { t } = useStore();
  const names: Record<string, string> = {
    pending: "قيد الانتظار",
    paid: "مدفوع",
    processing: "قيد التجهيز",
    shipped: "تم الشحن",
    delivered: "تم التوصيل",
    cancelled: "ملغي",
    refunded: "تم رد المبلغ",
    failed: "تعذّر",
    cod_pending: "غير مدفوع — عند الاستلام",
    awaiting_confirmation: "بانتظار التأكيد",
    rejected: "مرفوض",
    active: "نشط",
    inactive: "غير نشط",
    archived: "مؤرشف",
  };
  return <span className="status">{t(value, names[value] || value)}</span>;
}
export function Tracking() {
  const { t } = useStore();
  const [error, setError] = useState(""),
    [result, setResult] = useState<{
      reference: string;
      status: string;
      shipping_status: string;
      tracking_id: string | null;
    } | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle
        title={t("Follow your little parcel.", "تتبّعي رحلة طلبك.")}
        eyebrow={t("Order tracking", "تتبّع الطلب")}
      />
      <section className="wrap section compact narrow">
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setResult(null);
            try {
              setResult(
                await api(
                  "track",
                  "POST",
                  Object.fromEntries(new FormData(e.currentTarget)),
                ),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Order reference", "رقم الطلب")}
            <input
              name="reference"
              required
              maxLength={20}
              dir="ltr"
              placeholder="SOL-…"
            />
          </label>
          <label>
            {t("Private tracking key", "مفتاح التتبّع الخاص")}
            <input
              name="token"
              required
              minLength={64}
              maxLength={64}
              dir="ltr"
              autoComplete="off"
            />
          </label>
          <button className="button" disabled={busy}>
            {t("Track order", "تتبّع الطلب")}
            <Icon />
          </button>
        </form>
        {error && <ErrorMessage code={error} />}{" "}
        {result && (
          <div className="panel">
            <h2>{result.reference}</h2>
            <p>
              <Status value={result.status} />
            </p>
            <p>{t("Shipping status", "حالة الشحن")}: <Status value={result.shipping_status} /></p>
            {result.tracking_id && (
              <p>
                <bdi>{result.tracking_id}</bdi>
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
