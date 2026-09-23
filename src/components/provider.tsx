"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Locale, StoreData } from "@/lib/types";
import { Brand, Icon } from "./brand";
import { analytics, api } from "@/lib/api";
const Context = createContext({
  locale: "en" as Locale,
  t: (en: string, ar: string) => en || ar,
  notify: (message: string) => {
    void message;
  },
  data: null as unknown as StoreData,
});
export const useStore = () => useContext(Context);
export function Shell({
  children,
  locale: initial,
  data,
}: {
  children: React.ReactNode;
  locale: Locale;
  data: StoreData;
}) {
  const [locale, setLocale] = useState(initial),
    [open, setOpen] = useState(false),
    [message, setMessage] = useState(""),
    [customer, setCustomer] = useState(false);
  const path = usePathname(),
    router = useRouter();
  const t = (en: string, ar: string) => (locale === "ar" ? ar : en);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    setOpen(false);
    api("account/me").then(() => setCustomer(true)).catch(() => setCustomer(false));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("main > section, main .page-title, .product-detail, .footer-top, .footer-grid"),
    );
    if (reduced) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }
    document.body.classList.add("motion-ready");
    nodes.forEach((node) => node.classList.add("reveal"));
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }),
      { threshold: 0.08, rootMargin: "0px 0px -5%" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [path]);
  const links = [
    ["/", "Home", "الرئيسية"],
    ["/products", "Shop", "المنتجات"],
    ["/ingredients", "Ingredients", "المكوّنات"],
    ["/about", "Our story", "حكايتنا"],
    ["/contact", "Contact", "تواصل معنا"],
  ];
  function toggle() {
    const lang = locale === "ar" ? "en" : "ar";
    setLocale(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.cookie =
      "lang=" + lang + "; path=/; max-age=31536000; SameSite=Lax";
    router.refresh();
  }
  return (
    <Context.Provider value={{ locale, t, notify: setMessage, data }}>
      <a className="skip" href="#main">
        {t("Skip to content", "انتقل إلى المحتوى")}
      </a>
      <div className="announcement">
        {t(
          "Gentle care, inspired by nature.",
          "عناية لطيفة، بإلهام من الطبيعة.",
        )}
      </div>
      <header className="nav">
        <div className="wrap nav-inner">
          <Brand />
          <nav
            className={open ? "nav-links open" : "nav-links"}
            aria-label={t("Main navigation", "القائمة الرئيسية")}
          >
            {links.map(([href, en, ar]) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                {t(en, ar)}
              </Link>
            ))}
          </nav>
          <div className="nav-actions">
            <button
              className="language"
              onClick={toggle}
              aria-label={t("Switch to Arabic", "Switch to English")}
            >
              {t("العربية", "English")}
            </button>
            <Link
              className="account-link"
              href={customer ? "/account" : "/account/login"}
            >
              <Icon name="user" />
              <span>{customer ? t("My Account", "حسابي") : t("Sign In", "دخول")}</span>
            </Link>
            <Link
              className="icon-button"
              href="/cart"
              aria-label={t("Shopping bag", "سلة التسوّق")}
            >
              <Icon name="bag" />
            </Link>
            <button
              className="icon-button menu"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={t("Navigation", "قائمة التنقّل")}
            >
              <Icon name={open ? "close" : "menu"} />
            </button>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="footer">
        <div className="wrap">
          <div className="footer-top">
            <h2>
              {t("A little question? We’re here.", "لديكِ سؤال؟ نحن هنا.")}
            </h2>
            <a
              className="button light"
              href={"https://wa.me/20" + data.settings.phone.slice(1)}
              onClick={() => analytics("whatsapp_click")}
            >
              {t("Chat with SOLÉA", "تحدّثي مع SOLÉA")} <Icon />
            </a>
          </div>
          <div className="footer-grid">
            <div>
              <Brand />
              <p>
                {t(
                  "Botanical inspiration. Thoughtfully brought together.",
                  "إلهام نباتي، اجتمع بعناية.",
                )}
              </p>
            </div>
            <div>
              <h3>{t("Explore", "اكتشفي")}</h3>
              {links.slice(1).map(([href, en, ar]) => (
                <Link key={href} href={href}>
                  {t(en, ar)}
                </Link>
              ))}
              <Link href="/faq">{t("FAQ", "الأسئلة الشائعة")}</Link>
            </div>
            <div>
              <h3>{t("Customer care", "خدمة العملاء")}</h3>
              {[
                ["/track-order", "Track your order", "تتبّعي طلبك"],
                ["/shipping-policy", "Shipping", "الشحن"],
                ["/returns", "Returns", "الإرجاع"],
                ["/privacy", "Privacy", "الخصوصية"],
                ["/terms", "Terms", "الشروط والأحكام"],
              ].map(([href, en, ar]) => (
                <Link key={href} href={href}>
                  {t(en, ar)}
                </Link>
              ))}
            </div>
            <div>
              <h3>{t("Let’s connect", "تواصلي معنا")}</h3>
              <a href={"tel:+20" + data.settings.phone.slice(1)} dir="ltr">
                {data.settings.phone}
              </a>
              <a
                href={
                  "https://www.instagram.com/" + data.settings.instagram + "/"
                }
                rel="noopener noreferrer"
                target="_blank"
              >
                <bdi>@{data.settings.instagram}</bdi>
              </a>
              <p>{t("Delivery configured at checkout", "يُحدّد التوصيل عند إتمام الطلب")}</p>
            </div>
          </div>
          <div className="footer-bottom">
            <span>SOLÉA · CARE FROM NATURE</span>
            <Link href="/admin">
              {t("Store administration", "إدارة المتجر")}
            </Link>
          </div>
        </div>
      </footer>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  );
}
export function ErrorMessage({ code }: { code: string }) {
  const { t } = useStore();
  const messages: Record<string, [string, string]> = {
    INVALID_INPUT: [
      "Please check the entered information.",
      "راجعي البيانات المدخلة.",
    ],
    INVALID_LOGIN: [
      "The login details are incorrect.",
      "بيانات الدخول غير صحيحة.",
    ],
    INVALID_CUSTOMER_LOGIN: [
      "Invalid email or password.",
      "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    ],
    CUSTOMER_LOGIN_REQUIRED: [
      "Please sign in to continue.",
      "يرجى تسجيل الدخول للمتابعة.",
    ],
    PASSWORD_MISMATCH: [
      "The passwords do not match.",
      "كلمتا المرور غير متطابقتين.",
    ],
    CURRENT_PASSWORD_INVALID: [
      "The current password is incorrect.",
      "كلمة المرور الحالية غير صحيحة.",
    ],
    CLAIM_INVALID: [
      "The order ID or private tracking key is incorrect.",
      "رقم الطلب أو مفتاح التتبّع الخاص غير صحيح.",
    ],
    ORDER_ALREADY_CLAIMED: [
      "This order is already in your account.",
      "هذا الطلب مضاف بالفعل إلى حسابك.",
    ],
    ORDER_CLAIM_UNAVAILABLE: [
      "This order cannot be added to this account.",
      "لا يمكن إضافة هذا الطلب إلى هذا الحساب.",
    ],
    ADDRESS_NOT_FOUND: [
      "The address could not be found.",
      "لم يتم العثور على العنوان.",
    ],
    RATE_LIMITED: [
      "Too many attempts. Please try again later.",
      "محاولات كثيرة. حاولي مرة أخرى لاحقًا.",
    ],
    PRICE_UNAVAILABLE: [
      "The price has not been confirmed yet.",
      "السعر لم يُحدّد بعد.",
    ],
    INSUFFICIENT_STOCK: [
      "This quantity is currently unavailable.",
      "الكمية المطلوبة غير متاحة حاليًا.",
    ],
    INVALID_COUPON: [
      "This promo code cannot be applied.",
      "لا يمكن تطبيق رمز الخصم.",
    ],
    STORE_NOT_READY: ["Orders are not open yet.", "الطلبات غير متاحة بعد."],
    DELIVERY_UNAVAILABLE: [
      "Delivery is not configured for this location.",
      "التوصيل غير متاح لهذا العنوان حاليًا.",
    ],
    POLICIES_NOT_READY: [
      "This service will open once the store policies are published.",
      "ستُتاح هذه الخدمة بعد نشر سياسات المتجر.",
    ],
    LOGIN_REQUIRED: ["Please sign in.", "يرجى تسجيل الدخول."],
    FORBIDDEN: [
      "Your account does not have permission.",
      "حسابك لا يملك الصلاحية المطلوبة.",
    ],
    ORDER_NOT_FOUND: [
      "The order could not be found. Check your details.",
      "لم يتم العثور على الطلب. راجعي البيانات.",
    ],
    INVALID_TRANSITION: [
      "This change is not available for the current order state.",
      "هذا التغيير غير متاح لحالة الطلب الحالية.",
    ],
    INTEGRATION_NOT_CONFIGURED: [
      "This service is not available yet.",
      "هذه الخدمة غير متاحة بعد.",
    ],
    FILE_TOO_LARGE: [
      "Choose an image smaller than 4 MB.",
      "اختاري صورة أقل من 4 ميجابايت.",
    ],
    INVALID_FILE: [
      "Choose a valid JPEG, PNG or WebP image.",
      "اختاري صورة سليمة بصيغة JPEG أو PNG أو WebP.",
    ],
    ALREADY_EXISTS: [
      "This value is already in use.",
      "هذه القيمة مستخدمة بالفعل.",
    ],
    CSRF_REJECTED: [
      "Refresh the page and try again.",
      "حدّثي الصفحة وحاولي مرة أخرى.",
    ],
  };
  const m = messages[code] || [
    "We could not complete this request. Please try again.",
    "تعذّر إتمام الطلب. حاولي مرة أخرى.",
  ];
  return (
    <p className="notice error" role="alert">
      {t(...m)}
    </p>
  );
}
