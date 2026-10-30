"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, currency } from "@/lib/api";
import { useStore, ErrorMessage } from "./provider";
import { PageTitle } from "./storefront";
import { PaymentInstructions, Status, type OrderView } from "./checkout";

import { NewPasswordFields, recoveryFeedback, useRecoveryToken } from "./password-recovery";

type Account = {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string | null;
  metrics: { orders: number; units: number };
};
export type SavedAddress = {
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
};
type OrderSummary = {
  id: string;
  reference: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total: number;
  item_count: number;
  units: number;
  created_at: string;
};
type OrderDetail = OrderView & {
  subtotal: number;
  discount: number;
  shipping: number;
  created_at: string;
  governorate: string;
  city: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  shipping_status: string;
  tracking_id: string | null;
  items: { name_en: string; name_ar: string; quantity: number; unit_price: number }[];
};

export function AccountAuth({ mode }: { mode: "login" | "register" | "forgot" | "reset" }) {
  const { t, locale } = useStore();
  const { credential, clearCredential } = useRecoveryToken(mode === "reset", "token");
  const router = useRouter(),
    query = useSearchParams();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const title = {
    login: ["Welcome back.", "أهلًا بعودتك."],
    register: ["Create your SOLÉA account.", "أنشئي حسابك لدى SOLÉA."],
    forgot: ["Reset your password.", "استعادة كلمة المرور."],
    reset: ["Choose a new password.", "اختاري كلمة مرور جديدة."],
  }[mode] as [string, string];
  return (
    <>
      <PageTitle title={t(...title)} eyebrow={t("Customer account", "حساب العميل")} />
      <section className="section compact wrap account-auth">
        <form
          className="account-form panel"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || done) return;
            const form = event.currentTarget;
            setBusy(true);
            setError("");
            const fields = Object.fromEntries(new FormData(form));
            try {
              if (mode === "register") {
                if (fields.password !== fields.confirmPassword) throw new Error("PASSWORD_MISMATCH");
                await api("account/register", "POST", {
                  firstName: fields.firstName,
                  lastName: fields.lastName,
                  email: fields.email,
                  password: fields.password,
                  mobile: fields.mobile,
                });
                router.push("/account");
                router.refresh();
              } else if (mode === "login") {
                await api("account/login", "POST", fields);
                router.push("/account");
                router.refresh();
              } else if (mode === "forgot") {
                await api("account/reset-request", "POST", { email: fields.email, locale });
                setDone(true);
              } else {
                if (fields.password !== fields.confirmPassword) throw new Error("PASSWORD_MISMATCH");
                await api("account/reset", "POST", {
                  token: credential,
                  password: fields.password,
                });
                clearCredential();
                form.reset();
                router.replace("/account/login?passwordReset=1");
              }
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "register" && <><label>{t("First name", "الاسم الأول")}<input name="firstName" autoComplete="given-name" required maxLength={150} /></label><label>{t("Last name", "اسم العائلة")}<input name="lastName" autoComplete="family-name" required maxLength={150} /></label></>}
          {mode !== "reset" && (
            <label>{t("Email", "البريد الإلكتروني")}<input name="email" type="email" autoComplete="email" required maxLength={254} dir="ltr" /></label>
          )}
          {mode === "register" && (
            <label>{t("Mobile", "رقم الموبايل")}<input name="mobile" type="tel" autoComplete="tel" pattern="01[0125][0-9]{8}" dir="ltr" required /></label>
          )}
          {["login", "register"].includes(mode) && (
            <label>{t(mode === "login" ? "Password" : "New password", mode === "login" ? "كلمة المرور" : "كلمة المرور الجديدة")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={72} /></label>
          )}
          {mode === "register" && (
            <label>{t("Confirm password", "تأكيد كلمة المرور")}<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
          )}
          {mode === "reset" && <NewPasswordFields />}
          <button className="button full" disabled={busy || done || (mode === "reset" && !credential)}>
            {busy ? t("Please wait…", "يرجى الانتظار…") : t(mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset instructions" : "Update password", mode === "login" ? "تسجيل الدخول" : mode === "register" ? "إنشاء الحساب" : mode === "forgot" ? "إرسال تعليمات الاستعادة" : "تحديث كلمة المرور")}
          </button>
          {done && <p className="notice success" role="status">{t(...recoveryFeedback)}</p>}
          {mode === "login" && query.get("passwordReset") === "1" && <p className="notice success" role="status">{t("Password updated. You can sign in now.", "تم تحديث كلمة المرور. يمكنكِ تسجيل الدخول الآن.")}</p>}
          {mode === "reset" && (!credential || error === "INVALID_RESET") && <p className="notice"><Link href="/account/forgot">{t("This link is invalid or expired. Request new reset instructions.", "هذا الرابط غير صالح أو انتهت صلاحيته. اطلبي تعليمات استعادة جديدة.")}</Link></p>}
          {error && <ErrorMessage code={error} />}
          <div className="account-switch">
            {mode === "login" ? <><Link href="/account/forgot">{t("Forgot password?", "نسيتِ كلمة المرور؟")}</Link><Link href="/account/register">{t("Create account", "إنشاء حساب")}</Link></> : <Link href="/account/login">{t("Back to sign in", "العودة لتسجيل الدخول")}</Link>}
          </div>
        </form>
      </section>
    </>
  );
}

function AccountNav() {
  const { t } = useStore();
  return (
    <nav className="account-nav" aria-label={t("Account navigation", "التنقل داخل الحساب")}>
      <Link href="/account">{t("Overview", "نظرة عامة")}</Link>
      <Link href="/account/orders">{t("Orders", "الطلبات")}</Link>
      <Link href="/account/addresses">{t("Addresses", "العناوين")}</Link>
      <Link href="/account/profile">{t("Profile", "الملف الشخصي")}</Link>
      <Link href="/account/security">{t("Security", "الأمان")}</Link>
    </nav>
  );
}

function Orders({ rows }: { rows: OrderSummary[] }) {
  const { t, locale } = useStore();
  if (!rows.length)
    return <div className="empty account-empty"><h2>{t("No orders yet.", "لا توجد طلبات بعد.")}</h2><Link className="button" href="/products">{t("Explore products", "اكتشفي المنتجات")}</Link></div>;
  return (
    <div className="order-card-grid">
      {rows.map((order) => (
        <article className="order-card" key={order.id}>
          <div><span className="small">{new Date(order.created_at).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB")}</span><h3 dir="ltr">{order.reference}</h3></div>
          <div className="order-badges"><Status value={order.status} /><Status value={order.payment_status} /></div>
          <p>{t("Items", "المنتجات")}: {order.item_count} · {t("Units", "الوحدات")}: {order.units}</p>
          <strong>{currency(order.total, locale)}</strong>
          <div className="actions"><Link className="text-link" href={`/account/orders/${order.id}`}>{t("View details", "عرض التفاصيل")}</Link><Link className="text-link" href={`/account/orders/${order.id}`}>{t("Track", "تتبّع")}</Link></div>
        </article>
      ))}
    </div>
  );
}

function AddressForm({ initial, onSaved }: { initial?: SavedAddress; onSaved: () => void }) {
  const { t } = useStore();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form className="panel fields address-form" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      const form = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await api(`account/addresses${initial ? `/${initial.id}` : ""}`, initial ? "PUT" : "POST", {
          ...form,
          is_default: form.is_default === "on",
        });
        onSaved();
      } catch (error) {
        setError((error as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      {[
        ["label", "Label", "اسم العنوان", 80],
        ["full_name", "Full name", "الاسم الكامل", 150],
        ["mobile", "Mobile", "رقم الموبايل", 11],
        ["governorate", "Governorate", "المحافظة", 150],
        ["city", "City", "المدينة", 150],
        ["street", "Street address", "عنوان الشارع", 300],
        ["building", "Building", "المبنى", 60],
        ["floor", "Floor", "الدور", 30],
        ["apartment", "Apartment", "الشقة", 30],
      ].map(([name, en, ar, max]) => (
        <label key={String(name)}>{t(String(en), String(ar))}<input name={String(name)} defaultValue={initial?.[name as keyof SavedAddress] as string || ""} required={["full_name","mobile","governorate","city","street"].includes(String(name))} maxLength={Number(max)} dir={name === "mobile" ? "ltr" : undefined} pattern={name === "mobile" ? "01[0125][0-9]{8}" : undefined} /></label>
      ))}
      <label className="span-2">{t("Delivery notes", "ملاحظات التوصيل")}<textarea name="notes" defaultValue={initial?.notes || ""} maxLength={1000} /></label>
      <label className="check span-2"><input name="is_default" type="checkbox" defaultChecked={initial?.is_default} />{t("Set as default", "تعيين كعنوان افتراضي")}</label>
      <button className="button span-2" disabled={busy}>{t(initial ? "Save changes" : "Add address", initial ? "حفظ التعديلات" : "إضافة العنوان")}</button>
      {error && <div className="span-2"><ErrorMessage code={error} /></div>}
    </form>
  );
}

export function AccountCenter({ section, orderId }: { section: string; orderId?: string }) {
  const { t, locale } = useStore();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null),
    [orders, setOrders] = useState<OrderSummary[]>([]),
    [order, setOrder] = useState<OrderDetail | null>(null),
    [addresses, setAddresses] = useState<SavedAddress[]>([]),
    [editing, setEditing] = useState<SavedAddress | undefined>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const me = await api<Account>("account/me");
      setAccount(me);
      if (["dashboard", "orders"].includes(section)) setOrders(await api<OrderSummary[]>("account/orders"));
      if (section === "order" && orderId) setOrder(await api<OrderDetail>(`account/orders/${orderId}`));
      if (section === "addresses") setAddresses(await api<SavedAddress[]>("account/addresses"));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [section, orderId]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <section className="section wrap"><div className="account-skeleton" role="status">{t("Loading your account…", "جارٍ تحميل حسابك…")}</div></section>;
  if (!account)
    return <section className="section wrap narrow"><div className="empty"><h1>{t("Sign in to your account.", "سجّلي الدخول إلى حسابك.")}</h1><div className="actions"><Link className="button" href="/account/login">{t("Sign in", "تسجيل الدخول")}</Link><Link className="button secondary" href="/account/register">{t("Create account", "إنشاء حساب")}</Link></div></div>{error && <ErrorMessage code={error} />}</section>;
  return (
    <>
      <PageTitle title={section === "dashboard" ? t(`Welcome, ${account.name}.`, `أهلًا، ${account.name}.`) : t(section === "order" ? "Order details" : section[0].toUpperCase() + section.slice(1), section === "orders" ? "طلباتي" : section === "addresses" ? "العناوين المحفوظة" : section === "profile" ? "الملف الشخصي" : "الأمان")} eyebrow={t("My SOLÉA", "حسابي لدى SOLÉA")} />
      <section className="section compact wrap account-layout">
        <AccountNav />
        <div className="account-content">
          {section === "dashboard" && <>
            <div className="account-metrics"><article><strong>{account.metrics.orders}</strong><span>{t("Orders", "الطلبات")}</span></article><article><strong>{account.metrics.units}</strong><span>{t("Units ordered", "الوحدات المطلوبة")}</span></article></div>
            <div className="section-heading"><h2>{t("Recent orders", "أحدث الطلبات")}</h2><Link className="text-link" href="/account/orders">{t("View all", "عرض الكل")}</Link></div>
            <Orders rows={orders.slice(0, 3)} />
            <details className="panel claim-order"><summary>{t("Add an existing guest order", "إضافة طلب ضيف سابق")}</summary><form onSubmit={async (event) => { event.preventDefault(); setError(""); try { const values = Object.fromEntries(new FormData(event.currentTarget)); const claimed = await api<{ id: string }>("account/claim", "POST", values); router.push(`/account/orders/${claimed.id}`); } catch (error) { setError((error as Error).message); } }}><label>{t("Order ID", "رقم الطلب")}<input name="reference" required pattern="SOL-[A-F0-9]{16}" dir="ltr" /></label><label>{t("Private tracking key", "مفتاح التتبّع الخاص")}<input name="trackingKey" required minLength={64} maxLength={64} dir="ltr" /></label><button className="button">{t("Add order", "إضافة الطلب")}</button></form></details>
          </>}
          {section === "orders" && <Orders rows={orders} />}
          {section === "order" && order && <div className="order-detail">
            <div className="panel"><div className="payment-heading"><div><p className="eyebrow">{new Date(order.created_at).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB")}</p><h2 dir="ltr">{order.reference}</h2></div><Status value={order.status} /></div>{order.items.map((item, index) => <div className="total" key={index}><span>{t(item.name_en, item.name_ar)} × {item.quantity}</span><strong>{currency(item.unit_price * item.quantity, locale)}</strong></div>)}{[["Subtotal","المجموع الفرعي",order.subtotal],["Discount","الخصم",-order.discount],["Shipping","الشحن",order.shipping],["Total","الإجمالي",order.total]].map(([en,ar,value]) => <div className="total" key={String(en)}><span>{t(String(en),String(ar))}</span><strong>{currency(Number(value),locale)}</strong></div>)}</div>
            <div className="panel"><h2>{t("Delivery", "التوصيل")}</h2><p>{order.street}, {order.building}, {order.city}, {order.governorate}</p><p>{t("Shipping status", "حالة الشحن")}: <Status value={order.shipping_status} /></p>{order.tracking_id && <p dir="ltr">{order.tracking_id}</p>}</div>
            <PaymentInstructions order={order} onUpdated={(next) => setOrder({ ...order, ...next })} />
          </div>}
          {section === "addresses" && <><div className="section-heading"><h2>{t("Saved addresses", "العناوين المحفوظة")}</h2><button className="button secondary" onClick={() => setEditing(undefined)}>{t("New address", "عنوان جديد")}</button></div>{!addresses.length && <p className="notice">{t("No saved addresses yet.", "لا توجد عناوين محفوظة بعد.")}</p>}<div className="address-grid">{addresses.map((address) => <article className="address-card" key={address.id}><div>{address.is_default && <span className="status">{t("Default", "افتراضي")}</span>}<h3>{address.label || address.full_name}</h3><p>{address.street}, {address.city}, {address.governorate}</p><p dir="ltr">{address.mobile}</p></div><div className="actions"><button className="text-link" onClick={() => setEditing(address)}>{t("Edit", "تعديل")}</button><button className="text-link" onClick={async () => { await api(`account/addresses/${address.id}`, "DELETE"); await load(); }}>{t("Delete", "حذف")}</button></div></article>)}</div><AddressForm key={editing?.id || "new"} initial={editing} onSaved={() => { setEditing(undefined); void load(); }} /></>}
          {section === "profile" && <form className="panel account-form" onSubmit={async (event) => { event.preventDefault(); setError(""); try { await api("account/profile", "PUT", Object.fromEntries(new FormData(event.currentTarget))); await load(); } catch (error) { setError((error as Error).message); } }}><label>{t("First name", "الاسم الأول")}<input name="firstName" defaultValue={account.first_name} required maxLength={150} /></label><label>{t("Last name", "اسم العائلة")}<input name="lastName" defaultValue={account.last_name} required maxLength={150} /></label><label>{t("Mobile", "رقم الموبايل")}<input name="mobile" defaultValue={account.mobile || ""} required pattern="01[0125][0-9]{8}" dir="ltr" /></label><label>{t("Email", "البريد الإلكتروني")}<input value={account.email} disabled dir="ltr" /></label><p className="small">{t("Email changes require verified email delivery and are not enabled yet.", "تغيير البريد يحتاج إلى تحقق بالبريد وغير مفعّل حاليًا.")}</p><button className="button">{t("Save profile", "حفظ الملف")}</button></form>}
          {section === "security" && <><form className="panel account-form" onSubmit={async (event) => { event.preventDefault(); setError(""); const values = Object.fromEntries(new FormData(event.currentTarget)); if (values.newPassword !== values.confirmPassword) { setError("PASSWORD_MISMATCH"); return; } try { await api("account/change-password", "POST", { currentPassword: values.currentPassword, newPassword: values.newPassword }); router.refresh(); } catch (error) { setError((error as Error).message); } }}><label>{t("Current password", "كلمة المرور الحالية")}<input name="currentPassword" type="password" autoComplete="current-password" required /></label><label>{t("New password", "كلمة المرور الجديدة")}<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label><label>{t("Confirm new password", "تأكيد كلمة المرور الجديدة")}<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label><button className="button">{t("Change password", "تغيير كلمة المرور")}</button></form><button className="text-link" onClick={async () => { await api("account/logout", "POST"); router.push("/"); router.refresh(); }}>{t("Log out from this account", "تسجيل الخروج من الحساب")}</button></>}
          {error && <ErrorMessage code={error} />}
        </div>
      </section>
    </>
  );
}
