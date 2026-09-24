"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, currency, analytics } from "@/lib/api";
import { resolveOrderSuccessId } from "@/lib/routes";
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
    [method, setMethod] = useState<
      "cod" | "paymob" | "instapay" | "vodafone_cash"
    >("cod"),
    [account, setAccount] = useState<{
      name: string;
      first_name: string;
      last_name: string;
      email: string;
      mobile: string | null;
    } | null>(null),
    [accountChecked, setAccountChecked] = useState(false),
    [addresses, setAddresses] = useState<
      {
        id: string;
        label: string;
        full_name: string;
        mobile: string;
        governorate: string;
        city: string;
        street: string;
        building: string;
        floor: string;
        apartment: string;
        notes: string;
        is_default: boolean;
      }[]
    >([]),
    [selectedAddressId, setSelectedAddressId] = useState(""),
    [governorate, setGovernorate] = useState(""),
    [coupon, setCoupon] = useState(""),
    [estimate, setEstimate] = useState<{
      subtotal: number;
      shipping: number;
      discount: number;
      total: number;
    } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    api<Cart>("cart")
      .then(setCart)
      .catch((e) => setError(e.message));
    analytics("begin_checkout");
    api<{ name: string; first_name: string; last_name: string; email: string; mobile: string | null }>("account/me")
      .then(async (me) => {
        setAccount(me);
        const saved = await api<typeof addresses>("account/addresses");
        setAddresses(saved);
        const preferred =
          saved.find((address) => address.is_default) || saved[0];
        if (preferred) {
          setSelectedAddressId(preferred.id);
          setGovernorate(preferred.governorate);
        }
      })
      .catch(() => undefined)
      .finally(() => setAccountChecked(true));
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
        {!accountChecked ? (
          <p role="status">{t("Checking your account…", "جارٍ التحقق من حسابك…")}</p>
        ) : !account ? (
          <div className="empty">
            <h2>{t("Sign in to continue.", "سجّلي الدخول للمتابعة.")}</h2>
            <p>{t("Sign in or create your SOLÉA account to continue.", "سجّلي الدخول أو أنشئي حساب SOLÉA للمتابعة.")}</p>
            <div className="actions"><Link className="button" href="/account/login">{t("Sign in", "تسجيل الدخول")}</Link><Link className="button secondary" href="/account/register">{t("Create account", "إنشاء حساب")}</Link></div>
          </div>
        ) : !account.first_name || !account.last_name || !account.mobile ? (
          <div className="empty"><h2>{t("Complete your profile.", "أكملي ملفك الشخصي.")}</h2><p>{t("Your first name, last name and mobile number are required before ordering.", "الاسم الأول واسم العائلة ورقم الموبايل مطلوبة قبل الطلب.")}</p><Link className="button" href="/account/profile">{t("Complete profile", "إكمال الملف")}</Link></div>
        ) : !ready ? (
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
                const res = await api<{ id: string; checkoutUrl?: string }>(
                  "checkout",
                  "POST",
                  {
                    ...fields,
                    payment: method,
                    coupon,
                    locale,
                    governorate,
                    acceptTerms: fields.acceptTerms === "on",
                    savedAddressId: selectedAddressId || null,
                    saveAddress: fields.saveAddress === "on",
                    idempotencyKey: key,
                  },
                );
                sessionStorage.setItem("last-order", res.id);
                if (method === "paymob" && res.checkoutUrl) {
                  window.location.assign(res.checkoutUrl);
                  return;
                }
                router.push("/order-success?orderId=" + encodeURIComponent(res.id));
              } catch (e) {
                setError((e as Error).message);
                setKey(crypto.randomUUID());
                setBusy(false);
              }
            }}
          >
            <div>
              <div className="checkout-account-callout">
                <p>{t(`Signed in as ${account.name}.`, `تم تسجيل الدخول باسم ${account.name}.`)}</p>
              </div>
              <h2>{t("Your details", "بياناتك")}</h2>
              {account && addresses.length > 0 && (
                <label>
                  {t("Saved address", "عنوان محفوظ")}
                  <select
                    value={selectedAddressId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSelectedAddressId(id);
                      const chosen = addresses.find(
                        (address) => address.id === id,
                      );
                      setGovernorate(chosen?.governorate || "");
                    }}
                  >
                    <option value="">
                      {t("Enter a new address", "إدخال عنوان جديد")}
                    </option>
                    {addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label || `${address.street}, ${address.city}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectedAddressId ? (
                (() => {
                  const address = addresses.find(
                    (item) => item.id === selectedAddressId,
                  )!;
                  return (
                    <div className="selected-address panel">
                      <h3>{address.label || address.full_name}</h3>
                      <p>
                        {address.street}, {address.city}, {address.governorate}
                      </p>
                      <p dir="ltr">{address.mobile}</p>
                      <input
                        type="hidden"
                        name="fullName"
                        value={address.full_name}
                      />
                      <input
                        type="hidden"
                        name="mobile"
                        value={address.mobile}
                      />
                      <input
                        type="hidden"
                        name="email"
                        value={account?.email || ""}
                      />
                      <input type="hidden" name="city" value={address.city} />
                      <input
                        type="hidden"
                        name="street"
                        value={address.street}
                      />
                      <input
                        type="hidden"
                        name="building"
                        value={address.building}
                      />
                      <input type="hidden" name="floor" value={address.floor} />
                      <input
                        type="hidden"
                        name="apartment"
                        value={address.apartment}
                      />
                      <input type="hidden" name="notes" value={address.notes} />
                    </div>
                  );
                })()
              ) : (
                <div className="fields" key={account?.email || "guest"}>
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
                        defaultValue={
                          name === "fullName"
                            ? account?.name || ""
                            : name === "mobile"
                              ? account?.mobile || ""
                              : name === "email"
                                ? account?.email || ""
                                : ""
                        }
                        readOnly={name === "email" && !!account}
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
                      {data.settings.shipping_zones
                        .filter((r) => r.active)
                        .map((r) => (
                          <option key={r.governorate} value={r.governorate}>
                            {r.governorate}
                            {r.zone ? ` · ${r.zone}` : ""}
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
                  {account && (
                    <label className="check span-2">
                      <input name="saveAddress" type="checkbox" />
                      {t(
                        "Save this address to my account",
                        "حفظ هذا العنوان في حسابي",
                      )}
                    </label>
                  )}
                </div>
              )}
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
                <input
                  type="radio"
                  checked={method === "paymob"}
                  onChange={() => setMethod("paymob")}
                  disabled={!data.settings.paymob.enabled}
                />
                {t("Pay Online Securely", "الدفع الآمن أونلاين")}
              </label>
              <label className="payment">
                <input
                  type="radio"
                  checked={method === "instapay"}
                  onChange={() => setMethod("instapay")}
                  disabled={!data.settings.instapay.enabled}
                />
                InstaPay
              </label>
              <label className="payment">
                <input
                  type="radio"
                  checked={method === "vodafone_cash"}
                  onChange={() => setMethod("vodafone_cash")}
                  disabled={!data.settings.vodafoneCash.enabled}
                />
                Vodafone Cash
              </label>
              {method === "paymob" && (
                <p className="notice">
                  {t(
                    "You will continue to Paymob's secure hosted checkout. Your order is confirmed only after SOLÉA verifies the provider callback.",
                    "سيتم تحويلكِ إلى صفحة الدفع الآمنة لدى Paymob. لا يُؤكد الدفع إلا بعد تحقق SOLÉA من إشعار مزوّد الدفع.",
                  )}
                </p>
              )}
              {["instapay", "vodafone_cash"].includes(method) && (
                <>
                  <p className="notice">
                    {t(
                      "Your order will await admin confirmation after transfer. Only SOLÉA administrators can mark it paid.",
                      "سيظل الطلب بانتظار مراجعة التحويل. مسؤولو SOLÉA فقط يمكنهم تأكيد الدفع.",
                    )}
                  </p>
                  <label>
                    {t(
                      "Transfer reference (optional)",
                      "مرجع التحويل (اختياري)",
                    )}
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
                {t(
                  "Shipping configured for the selected area",
                  "الشحن حسب المنطقة المختارة",
                )}
              </p>
              <button
                className="button full"
                disabled={
                  busy ||
                  !estimate ||
                  (method === "cod"
                    ? !data.settings.cod_enabled
                    : method === "paymob"
                      ? !data.settings.paymob.enabled
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
export type OrderView = {
  id: string;
  reference: string;
  status: string;
  payment_status: string;
  payment_method: string;
  transfer_reference: string | null;
  proof_uploaded: boolean;
  total: number;
  trackingToken: string;
  items: {
    name_en: string;
    name_ar: string;
    quantity: number;
    unit_price: number;
  }[];
};

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: [string, string];
}) {
  const { t } = useStore();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-button"
      onClick={async () => {
        try {
          if (navigator.clipboard?.writeText)
            await navigator.clipboard.writeText(value);
          else {
            const fallback = document.createElement("textarea");
            fallback.value = value;
            fallback.setAttribute("readonly", "");
            fallback.style.position = "fixed";
            fallback.style.opacity = "0";
            document.body.appendChild(fallback);
            fallback.select();
            if (!document.execCommand("copy")) throw new Error("COPY_FAILED");
            fallback.remove();
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? t("Copied", "تم النسخ") : t(...label)}
    </button>
  );
}

export function PaymentInstructions({
  order,
  onUpdated,
}: {
  order: OrderView;
  onUpdated: (order: OrderView) => void;
}) {
  const { t, locale, data, notify } = useStore();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!["instapay", "vodafone_cash"].includes(order.payment_method))
    return null;
  const insta = order.payment_method === "instapay";
  const identifier = insta
    ? data.settings.instapay.account
    : data.settings.vodafoneCash.number;
  const qrUrl = insta
    ? data.settings.instapay.qrUrl
    : data.settings.vodafoneCash.qrUrl;
  return (
    <section
      className="payment-instructions"
      aria-labelledby="manual-payment-title"
    >
      <div className="payment-heading">
        <div>
          <p className="eyebrow">{t("Manual payment", "دفع يدوي")}</p>
          <h2 id="manual-payment-title">
            {insta ? "InstaPay" : "Vodafone Cash"}
          </h2>
        </div>
        <Status value={order.payment_status} />
      </div>
      <div className="payment-grid">
        <div className="qr-shell">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={
                insta
                  ? "InstaPay payment QR code"
                  : "Vodafone Cash payment QR code"
              }
              width="280"
              height="280"
            />
          ) : (
            <div className="qr-empty">
              {t("QR code not configured yet.", "رمز QR غير مُعد حتى الآن.")}
            </div>
          )}
        </div>
        <div className="payment-facts">
          <span>
            {insta
              ? t("InstaPay account", "حساب InstaPay")
              : t("Receiving number", "رقم الاستلام")}
          </span>
          {identifier ? (
            <div className="copy-row">
              <strong dir="ltr">{identifier}</strong>
              <CopyButton
                value={identifier}
                label={
                  insta
                    ? ["Copy account", "نسخ الحساب"]
                    : ["Copy number", "نسخ الرقم"]
                }
              />
            </div>
          ) : (
            <p className="small">
              {t(
                "Payment identifier not configured yet.",
                "بيانات الاستلام غير مُعدّة حتى الآن.",
              )}
            </p>
          )}
          <span>{t("Exact amount", "المبلغ المطلوب")}</span>
          <strong>{currency(order.total, locale)}</strong>
          <span>{t("Order ID", "رقم الطلب")}</span>
          <div className="copy-row">
            <strong dir="ltr">{order.reference}</strong>
            <CopyButton
              value={order.reference}
              label={["Copy order ID", "نسخ رقم الطلب"]}
            />
          </div>
        </div>
      </div>
      <ol className="payment-steps">
        <li>
          {t(
            `Scan the QR code or copy the ${insta ? "InstaPay account" : "Vodafone Cash number"}.`,
            `امسحي رمز QR أو انسخي ${insta ? "حساب InstaPay" : "رقم Vodafone Cash"}.`,
          )}
        </li>
        <li>
          {t(
            "Transfer the exact order amount.",
            "حوّلي مبلغ الطلب كاملًا كما هو موضح.",
          )}
        </li>
        <li>{t("Keep the transaction reference.", "احتفظي بمرجع التحويل.")}</li>
        <li>
          {t(
            "Submit the reference and proof when available.",
            "أرسلي مرجع التحويل وصورة الإيصال إن توفرت.",
          )}
        </li>
        <li>
          {t(
            "Payment remains Awaiting Confirmation until SOLÉA verifies it.",
            "تظل حالة الدفع بانتظار التأكيد حتى تراجع SOLÉA التحويل.",
          )}
        </li>
      </ol>
      {order.payment_status === "awaiting_confirmation" &&
        order.status === "pending" && (
          <div className="payment-submit-grid">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const reference = String(
                    new FormData(e.currentTarget).get("reference") || "",
                  );
                  await api("payment-submission", "POST", {
                    orderId: order.id,
                    reference,
                  });
                  onUpdated({ ...order, transfer_reference: reference });
                  notify(
                    t(
                      "Payment submitted for verification.",
                      "تم إرسال بيانات الدفع للمراجعة.",
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
                {t("Transaction reference", "مرجع التحويل")}
                <input
                  name="reference"
                  defaultValue={order.transfer_reference || ""}
                  required
                  maxLength={120}
                  dir="ltr"
                />
              </label>
              <button className="button secondary" disabled={busy}>
                {t("Submit reference", "إرسال المرجع")}
              </button>
            </form>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const form = new FormData(e.currentTarget);
                  form.set("orderId", order.id);
                  await api("payment-proof", "POST", form);
                  onUpdated({ ...order, proof_uploaded: true });
                  notify(
                    t(
                      "Payment submitted for verification.",
                      "تم إرسال بيانات الدفع للمراجعة.",
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
                {t("Payment proof", "صورة إيصال الدفع")}
                <input
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
              </label>
              <button className="button secondary" disabled={busy}>
                {order.proof_uploaded
                  ? t("Replace proof", "استبدال الإيصال")
                  : t("Upload proof", "رفع الإيصال")}
              </button>
            </form>
          </div>
        )}
      {(order.transfer_reference || order.proof_uploaded) &&
        order.payment_status === "awaiting_confirmation" && (
          <p className="notice success">
            {t("Submitted for verification.", "تم الإرسال للمراجعة.")}
          </p>
        )}
      {order.payment_status === "rejected" && (
        <p className="notice error">
          {t(
            "Payment was rejected. Contact SOLÉA before sending another transfer.",
            "تم رفض الدفع. تواصلي مع SOLÉA قبل إجراء تحويل جديد.",
          )}
        </p>
      )}
      {error && <ErrorMessage code={error} />}
    </section>
  );
}
export function OrderSuccess() {
  const { t, locale } = useStore();
  const query = useSearchParams();
  const [order, setOrder] = useState<OrderView | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const id = resolveOrderSuccessId(
      query,
      sessionStorage.getItem("last-order"),
    );
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
            <PaymentInstructions order={order} onUpdated={setOrder} />
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
            <p>
              {t("Shipping status", "حالة الشحن")}:{" "}
              <Status value={result.shipping_status} />
            </p>
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
