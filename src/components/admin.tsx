"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, parseMoney, currency } from "@/lib/api";
import { Product } from "@/lib/types";
import { useStore, ErrorMessage } from "./provider";
import { Brand } from "./brand";
import { Status } from "./checkout";
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
export function Login() {
  const { t } = useStore();
  const router = useRouter(),
    query = useSearchParams();
  const reset = query.get("reset");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [forgot, setForgot] = useState(false),
    [done, setDone] = useState(false);
  return (
    <section className="admin-login section wrap">
      <div className="panel">
        <Brand />
        <p className="eyebrow">{t("Store administration", "إدارة المتجر")}</p>
        <h1>
          {reset
            ? t("Reset password", "تعيين كلمة مرور جديدة")
            : forgot
              ? t("Forgot password", "نسيت كلمة المرور")
              : t("Welcome back.", "أهلًا بعودتك.")}
        </h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = Object.fromEntries(new FormData(e.currentTarget));
            try {
              if (reset) {
                await api("auth/reset", "POST", {
                  token: reset,
                  password: f.password,
                });
                setDone(true);
              } else if (forgot) {
                await api("auth/reset-request", "POST", f);
                setDone(true);
              } else {
                await api("auth/login", "POST", f);
                router.push("/admin/dashboard");
                router.refresh();
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!reset && (
            <label>
              {t("Email", "البريد الإلكتروني")}
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                maxLength={254}
                dir="ltr"
              />
            </label>
          )}
          {(!forgot || reset) && (
            <label>
              {t("Password", "كلمة المرور")}
              <input
                type="password"
                name="password"
                autoComplete={reset ? "new-password" : "current-password"}
                required
                minLength={reset ? 12 : 1}
                maxLength={72}
                dir="ltr"
              />
            </label>
          )}
          {reset && (
            <p className="small">
              {t(
                "At least 12 characters, including uppercase, lowercase and a number.",
                "12 حرفًا على الأقل، تشمل حرفًا إنجليزيًا كبيرًا وصغيرًا ورقمًا.",
              )}
            </p>
          )}
          <button className="button full" disabled={busy}>
            {t(
              reset ? "Update password" : forgot ? "Request reset" : "Sign in",
              reset
                ? "تحديث كلمة المرور"
                : forgot
                  ? "طلب إعادة التعيين"
                  : "تسجيل الدخول",
            )}
          </button>
        </form>
        {done && (
          <p className="notice">
            {reset
              ? t(
                  "Password changed. Sign in again.",
                  "تم تغيير كلمة المرور. سجّلي الدخول مجددًا.",
                )
              : t(
                  "If the account is eligible and email is configured, reset instructions will be sent.",
                  "إذا كان الحساب مؤهلًا وخدمة البريد مفعّلة، ستُرسل تعليمات إعادة التعيين.",
                )}
          </p>
        )}
        {error && <ErrorMessage code={error} />}
        <button
          className="text-link"
          onClick={() => {
            setForgot(!forgot);
            setDone(false);
          }}
        >
          {t(
            forgot ? "Back to login" : "Forgot password?",
            forgot ? "العودة للدخول" : "نسيت كلمة المرور؟",
          )}
        </button>
      </div>
    </section>
  );
}
const sections = [
  ["dashboard", "Overview", "نظرة عامة", ""],
  ["products", "Products", "المنتجات", "products"],
  ["orders", "Orders", "الطلبات", "orders"],
  ["customers", "Customers", "العملاء", "customers"],
  ["content", "Content", "المحتوى", "content"],
  ["coupons", "Discounts", "الخصومات", "coupons"],
  ["settings", "Settings", "الإعدادات", "settings"],
  ["jobs", "Integration jobs", "مهام التكامل", "settings"],
  ["users", "Admin users", "المسؤولون", "users"],
  ["audit", "Audit log", "سجل التدقيق", "audit"],
];
export function Admin({
  path,
  user,
}: {
  path: string[];
  user: { email: string; permissions: string[] };
}) {
  const { t, notify } = useStore();
  const router = useRouter();
  const section = path[0] || "dashboard",
    id = path[1];
  const [data, setData] = useState<unknown>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const load = useCallback(() => {
    setError("");
    if (section === "products" && id === "new") {
      setData({});
      return;
    }
    api(
      "admin/" +
        section +
        (id ? "/" + id : "") +
        (section === "orders" || section === "customers"
          ? "?q=" + encodeURIComponent(search)
          : ""),
    )
      .then(setData)
      .catch((e) => setError(e.message));
  }, [section, id, search]);
  useEffect(load, [load]);
  async function mutate(url: string, method: string, body?: unknown) {
    try {
      await api("admin/" + url, method, body);
      notify(t("Saved.", "تم الحفظ."));
      load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  return (
    <div className="wrap admin-layout">
      <aside className="admin-sidebar">
        <p className="eyebrow">SOLÉA ADMIN</p>
        <p className="small">{user.email}</p>
        <nav>
          {sections
            .filter((x) => !x[3] || user.permissions.includes(x[3]))
            .map(([key, en, ar]) => (
              <Link
                href={"/admin/" + key}
                key={key}
                aria-current={section === key ? "page" : undefined}
              >
                {t(en, ar)}
              </Link>
            ))}
        </nav>
        <button
          className="text-link"
          onClick={async () => {
            await api("auth/logout", "POST");
            router.push("/admin");
            router.refresh();
          }}
        >
          {t("Sign out", "تسجيل الخروج")}
        </button>
      </aside>
      <div className="admin-main">
        <div className="section-heading">
          <h1>
            {t(
              sections.find((x) => x[0] === section)?.[1] || "Administration",
              sections.find((x) => x[0] === section)?.[2] || "الإدارة",
            )}
          </h1>
          {section === "products" && !id && (
            <Link className="button" href="/admin/products/new">
              {t("Add product", "إضافة منتج")}
            </Link>
          )}
        </div>
        {error && <ErrorMessage code={error} />}{" "}
        {data === null && !error && (
          <p role="status">{t("Loading…", "جارٍ التحميل…")}</p>
        )}
        {section === "dashboard" && data !== null && (
          <Dashboard data={data as Row} />
        )}
        {section === "jobs" && (
          <>
            <DataTable
              rows={rows}
              columns={[
                "kind",
                "order_id",
                "status",
                "attempts",
                "last_error",
                "created_at",
              ]}
            />
            {rows
              .filter((r) => r.status === "failed")
              .map((r) => (
                <div className="panel" key={str(r.id)}>
                  <p>
                    <bdi>
                      {str(r.kind)} · {str(r.order_id)}
                    </bdi>
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => mutate("jobs/" + r.id + "/retry", "POST")}
                  >
                    {t("Retry job", "إعادة محاولة المهمة")}
                  </button>
                </div>
              ))}
          </>
        )}
        {section === "products" && id && data !== null && (
          <ProductEditor
            initial={id === "new" ? null : (data as Product)}
            onSave={async (d) => {
              const ok = await mutate(
                "products" + (id === "new" ? "" : "/" + id),
                id === "new" ? "POST" : "PUT",
                d,
              );
              if (ok) router.push("/admin/products");
            }}
          />
        )}
        {section === "products" && !id && (
          <>
            <DataTable
              rows={rows}
              columns={["name_en", "sku", "price", "stock", "status"]}
              link={(r) => "/admin/products/" + r.id}
            />
            <CategoryEditor />
          </>
        )}
        {["orders", "customers"].includes(section) && !id && (
          <label>
            {t(
              "Search reference, email or mobile",
              "بحث برقم الطلب أو البريد أو الموبايل",
            )}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
            />
          </label>
        )}
        {section === "orders" && !id && (
          <DataTable
            rows={rows}
            columns={[
              "reference",
              "name",
              "status",
              "payment_method",
              "payment_status",
              "total",
              "created_at",
            ]}
            link={(r) => "/admin/orders/" + r.id}
          />
        )}
        {section === "orders" && id && data !== null && (
          <OrderAdmin
            order={data as Row}
            canVerify={user.permissions.includes("payments")}
            mutate={(action, body) =>
              mutate(
                "orders/" + id + (action ? "/" + action : ""),
                "POST",
                body,
              )
            }
          />
        )}
        {section === "customers" && (
          <DataTable
            rows={rows}
            columns={["name", "email", "mobile", "reference", "created_at"]}
            link={(r) => "/admin/orders/" + r.order_id}
          />
        )}
        {section === "audit" && (
          <DataTable
            rows={rows}
            columns={[
              "created_at",
              "actor",
              "action",
              "entity",
              "entity_id",
              "metadata",
            ]}
          />
        )}
        {section === "content" && data !== null && (
          <ContentEditor
            rows={rows}
            save={(d) => mutate("content", "PUT", d)}
          />
        )}
        {section === "settings" && data !== null && (
          <SettingsEditor
            initial={data as Row}
            save={(d) => mutate("settings", "PUT", d)}
          />
        )}
        {section === "coupons" && data !== null && (
          <CouponEditor
            rows={rows}
            save={(id, d) =>
              mutate("coupons" + (id ? "/" + id : ""), id ? "PUT" : "POST", d)
            }
          />
        )}
        {section === "users" && data !== null && (
          <Users
            rows={rows}
            save={(url, method, d) => mutate(url, method, d)}
          />
        )}
      </div>
    </div>
  );
}
function Dashboard({ data }: { data: Row }) {
  const { t } = useStore();
  return (
    <>
      <div className="metric-grid">
        <div className="panel">
          <p>{t("Active products", "المنتجات النشطة")}</p>
          <strong>{str(data.products)}</strong>
        </div>
        <div className="panel">
          <p>
            {t(
              "Integration jobs needing attention",
              "عمليات التكامل التي تحتاج مراجعة",
            )}
          </p>
          <strong>{str(data.jobs)}</strong>
        </div>
      </div>
      <DataTable rows={data.orders as Row[]} columns={["status", "count"]} />
      <p className="notice">
        {t(
          "Before accepting orders: configure product prices and stock, delivery rates, approved policies, payment and email services.",
          "قبل استقبال الطلبات: اضبطي الأسعار والمخزون ورسوم التوصيل والسياسات المعتمدة وخدمات الدفع والبريد.",
        )}
      </p>
    </>
  );
}
const labels: Record<string, string> = {
  name_en: "الاسم بالإنجليزية",
  name_ar: "الاسم بالعربية",
  sku: "رمز المنتج",
  slug: "رابط المنتج",
  price: "السعر",
  stock: "المخزون",
  status: "الحالة",
  reference: "رقم الطلب",
  name: "الاسم",
  payment_status: "حالة الدفع",
  total: "الإجمالي",
  created_at: "تاريخ الإنشاء",
  email: "البريد الإلكتروني",
  mobile: "الموبايل",
  actor: "المسؤول",
  action: "الإجراء",
  entity: "الكيان",
  entity_id: "معرّف الكيان",
  metadata: "التفاصيل",
  count: "العدد",
  code: "الرمز",
  type: "النوع",
  value: "القيمة",
  used: "الاستخدامات",
  active: "نشط",
  role_id: "الدور",
  usage_limit: "الحد الأقصى",
  volume: "الحجم",
  description_en: "الوصف بالإنجليزية",
  description_ar: "الوصف بالعربية",
  usage_en: "الاستخدام بالإنجليزية",
  usage_ar: "الاستخدام بالعربية",
  warnings_en: "التحذيرات بالإنجليزية",
  warnings_ar: "التحذيرات بالعربية",
  inci: "قائمة INCI",
  seo_title: "عنوان محركات البحث",
  seo_description: "وصف محركات البحث",
  title_en: "العنوان بالإنجليزية",
  title_ar: "العنوان بالعربية",
  body_en: "النص بالإنجليزية",
  body_ar: "النص بالعربية",
};
function DataTable({
  rows,
  columns,
  link,
}: {
  rows: Row[];
  columns: string[];
  link?: (row: Row) => string;
}) {
  const { t, locale } = useStore();
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{t(c.replaceAll("_", " "), labels[c] || c)}</th>
            ))}
            {link && <th>{t("Open", "فتح")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={str(r.id) || i}>
              {columns.map((c) => (
                <td key={c}>
                  {["status", "payment_status"].includes(c) ? (
                    <Status value={str(r[c])} />
                  ) : ["price", "total", "unit_price"].includes(c) ? (
                    r[c] == null ? (
                      "—"
                    ) : (
                      currency(Number(r[c]), locale)
                    )
                  ) : typeof r[c] === "object" ? (
                    JSON.stringify(r[c])
                  ) : (
                    str(r[c])
                  )}
                </td>
              ))}
              {link && (
                <td>
                  <Link className="text-link" href={link(r)}>
                    {t("Open", "فتح")}
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="empty">{t("Nothing here yet.", "لا توجد بيانات بعد.")}</p>
      )}
    </div>
  );
}
function ProductEditor({
  initial,
  onSave,
}: {
  initial: Product | null;
  onSave: (d: unknown) => Promise<void>;
}) {
  const { t } = useStore();
  const [categories, setCategories] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Row[]>("admin/categories")
      .then(setCategories)
      .catch((e) => setError(e.message));
  }, []);
  const fields = [
    "name_en",
    "name_ar",
    "sku",
    "slug",
    "volume",
    "description_en",
    "description_ar",
    "usage_en",
    "usage_ar",
    "warnings_en",
    "warnings_ar",
    "inci",
    "seo_title",
    "seo_description",
  ];
  return (
    <>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const d = Object.fromEntries(new FormData(e.currentTarget));
            await onSave({
              ...d,
              category_id: d.category_id || null,
              price: parseMoney(str(d.price)),
              stock: Number(d.stock),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="fields">
          {fields.map((name) => {
            const value = initial
              ? str(initial[name as keyof Product])
              : name === "volume"
                ? "125 mL"
                : "";
            const long = /description|usage|warnings|inci/.test(name);
            return (
              <label key={name} className={long ? "span-2" : ""}>
                {t(name.replaceAll("_", " "), labels[name] || name)}
                {long ? (
                  <textarea
                    name={name}
                    defaultValue={value}
                    maxLength={name === "seo_description" ? 300 : 8000}
                    dir={name.endsWith("_ar") ? "rtl" : "ltr"}
                  />
                ) : (
                  <input
                    name={name}
                    defaultValue={value}
                    required={["name_en", "name_ar", "sku", "slug"].includes(
                      name,
                    )}
                    maxLength={150}
                    dir={name.endsWith("_ar") ? "rtl" : "ltr"}
                  />
                )}
              </label>
            );
          })}
          <label>
            {t(
              "Price in EGP (leave blank until confirmed)",
              "السعر بالجنيه (اتركيه فارغًا حتى التأكيد)",
            )}
            <input
              name="price"
              inputMode="decimal"
              defaultValue={initial?.price ? String(initial.price / 100) : ""}
            />
          </label>
          <label>
            {t("Available stock", "المخزون المتاح")}
            <input
              name="stock"
              type="number"
              min="0"
              max="1000000"
              step="1"
              required
              defaultValue={initial?.stock || 0}
            />
          </label>
          <label>
            {t("Status", "الحالة")}
            <select name="status" defaultValue={initial?.status || "inactive"}>
              {["active", "inactive", "archived"].map((v) => (
                <option key={v} value={v}>
                  {t(
                    v,
                    { active: "نشط", inactive: "غير نشط", archived: "مؤرشف" }[
                      v
                    ]!,
                  )}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Category", "الفئة")}
            <select
              name="category_id"
              defaultValue={initial?.category_id || ""}
            >
              <option value="">{t("No category", "بدون فئة")}</option>
              {categories.map((c) => (
                <option key={str(c.id)} value={str(c.id)}>
                  {t(str(c.name_en), str(c.name_ar))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="button" disabled={busy}>
          {t("Save product", "حفظ المنتج")}
        </button>
        {error && <ErrorMessage code={error} />}
      </form>
      {initial && <ImageEditor product={initial} />}
    </>
  );
}
function ImageEditor({ product }: { product: Product }) {
  const { t, notify } = useStore();
  const [images, setImages] = useState(product.images),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>{t("Product images", "صور المنتج")}</h2>
      <div className="image-editor">
        {images.map((img, i) => (
          <div key={img.id}>
            <img src={img.url} alt={img.alt_en} width="180" height="180" />
            <label>
              {t("English description", "الوصف بالإنجليزية")}
              <input
                value={img.alt_en}
                onChange={(e) =>
                  setImages(
                    images.map((x) =>
                      x.id === img.id ? { ...x, alt_en: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              {t("Arabic description", "الوصف بالعربية")}
              <input
                value={img.alt_ar}
                onChange={(e) =>
                  setImages(
                    images.map((x) =>
                      x.id === img.id ? { ...x, alt_ar: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              disabled={!i}
              onClick={() => {
                const copy = [...images];
                [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
                setImages(copy);
              }}
            >
              {t("Move earlier", "تقديم الصورة")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirm(t("Remove this image?", "إزالة هذه الصورة؟"))) return;
                setBusy(true);
                setError("");
                try {
                  await api(`admin/products/${product.id}/images/${img.id}`, "DELETE");
                  setImages(images.filter((x) => x.id !== img.id));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Remove", "إزالة")}
            </button>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const replacement = await api<Product["images"][0]>(
                  `admin/products/${product.id}/images/${img.id}`,
                  "PUT",
                  new FormData(e.currentTarget),
                );
                setImages(images.map((x) => x.id === img.id ? replacement : x));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}>
              <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
              <button type="submit" disabled={busy}>{t("Replace", "استبدال")}</button>
            </form>
          </div>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api<Product["images"][0]>(
              "admin/products/" + product.id + "/images",
              "POST",
              new FormData(e.currentTarget),
            );
            setImages([...images, r]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t(
            "Upload JPEG, PNG or WebP · max 4 MB",
            "رفع JPEG أو PNG أو WebP · حد أقصى 4 ميجابايت",
          )}
          <input
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {t("Upload", "رفع")}
        </button>
      </form>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          try {
            await api("admin/products/" + product.id + "/images", "PUT", {
              images: images.map(({ id, alt_en, alt_ar }) => ({
                id,
                alt_en,
                alt_ar,
              })),
            });
            notify(t("Images saved.", "تم حفظ الصور."));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {t("Save order & descriptions", "حفظ الترتيب والأوصاف")}
      </button>
      {error && <ErrorMessage code={error} />}
    </section>
  );
}
function CategoryEditor() {
  const { t, notify } = useStore();
  const [error, setError] = useState("");
  return (
    <details className="panel">
      <summary>{t("Add a category", "إضافة فئة")}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          try {
            await api(
              "admin/categories",
              "POST",
              Object.fromEntries(new FormData(form)),
            );
            notify(t("Category added.", "تمت إضافة الفئة."));
            form.reset();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {[
          ["name_en", "English name", "الاسم بالإنجليزية"],
          ["name_ar", "Arabic name", "الاسم بالعربية"],
          ["slug", "URL slug", "الرابط"],
        ].map(([name, en, ar]) => (
          <label key={name}>
            {t(en, ar)}
            <input name={name} required maxLength={100} />
          </label>
        ))}
        <button className="button">{t("Add", "إضافة")}</button>
        {error && <ErrorMessage code={error} />}
      </form>
    </details>
  );
}
function OrderAdmin({
  order: o,
  canVerify,
  mutate,
}: {
  order: Row;
  canVerify: boolean;
  mutate: (action: string, body?: unknown) => Promise<boolean>;
}) {
  const { t, locale } = useStore();
  return (
    <>
      <div className="panel">
        <h2>{str(o.reference)}</h2>
        <div className="order-facts">
          {[
            "name",
            "email",
            "mobile",
            "governorate",
            "city",
            "street",
            "building",
            "floor",
            "apartment",
            "notes",
            "created_at",
            "payment_method",
            "payment_status",
            "transfer_reference",
            "payment_verified_by",
            "verified_at",
            "rejection_reason",
            "shipping_status",
            "tracking_id",
          ].map((k) => (
            <p key={k}>
              <strong>
                {t(
                  k.replaceAll("_", " "),
                  labels[k] ||
                    (
                      {
                        governorate: "المحافظة",
                        city: "المدينة",
                        street: "الشارع",
                        building: "المبنى",
                        floor: "الدور",
                        apartment: "الشقة",
                        notes: "ملاحظات",
                        shipping_status: "حالة الشحن",
                        tracking_id: "رقم التتبّع",
                      } as Record<string, string>
                    )[k] ||
                    k,
                )}
              </strong>
              <span>{str(o[k]) || "—"}</span>
            </p>
          ))}
        </div>
        <DataTable
          rows={o.items as Row[]}
          columns={["name_en", "quantity", "unit_price"]}
        />
        <p>
          {t("Total", "الإجمالي")}: {currency(Number(o.total), locale)}
        </p>
        <form
          className="input-row"
          onSubmit={async (e) => {
            e.preventDefault();
            await mutate("", {
              status: new FormData(e.currentTarget).get("status"),
            });
          }}
        >
          <label>
            {t("Update order status", "تحديث حالة الطلب")}
            <select name="status">
              {["processing", "shipped", "delivered", "cancelled"].map((v) => (
                <option key={v} value={v}>
                  {t(
                    v,
                    {
                      processing: "قيد التجهيز",
                      shipped: "تم الشحن",
                      delivered: "تم التوصيل",
                      cancelled: "ملغي",
                    }[v]!,
                  )}
                </option>
              ))}
            </select>
          </label>
          <button className="button">{t("Update", "تحديث")}</button>
        </form>
        <div className="actions">
          {canVerify &&
            o.payment_method === "cod" &&
            o.status === "delivered" &&
            o.payment_status === "cod_pending" && (
              <button
                className="button secondary"
                onClick={() => {
                  if (
                    confirm(
                      t(
                        "Confirm that the full cash payment was collected?",
                        "تأكيد تحصيل المبلغ النقدي كاملًا؟",
                      ),
                    )
                  )
                    void mutate("collect-cod");
                }}
              >
                {t("Confirm cash collected", "تأكيد تحصيل المبلغ")}
              </button>
            )}
          {canVerify && ["instapay", "vodafone_cash"].includes(str(o.payment_method)) && o.payment_status === "awaiting_confirmation" && (
            <>
              <button className="button" onClick={() => {
                if (confirm(t("Confirm this payment after checking the transfer?", "تأكيد الدفع بعد مراجعة التحويل؟"))) void mutate("confirm-payment", {});
              }}>{t("Confirm payment", "تأكيد الدفع")}</button>
              <button className="button secondary" onClick={() => {
                const reason = prompt(t("Reason for rejection", "سبب الرفض"));
                if (reason?.trim()) void mutate("reject-payment", { reason });
              }}>{t("Reject payment", "رفض الدفع")}</button>
            </>
          )}
          {canVerify && !!o.proof_storage_path && (
            <a className="button secondary" href={`/api/admin/orders/${o.id}/payment-proof`} target="_blank" rel="noreferrer">
              {t("View payment proof", "عرض إيصال الدفع")}
            </a>
          )}
        </div>
        <p className="small">
          {t(
            "Only valid server-side order and payment transitions are accepted.",
            "يُسمح فقط بانتقالات الطلب والدفع المعتمدة على الخادم.",
          )}
        </p>
      </div>
    </>
  );
}
function ContentEditor({
  rows,
  save,
}: {
  rows: Row[];
  save: (d: unknown) => Promise<boolean>;
}) {
  const { t } = useStore();
  const [key, setKey] = useState(str(rows[0]?.key));
  const entry = rows.find((r) => r.key === key);
  return (
    <>
      <label>
        {t("Select content", "اختاري المحتوى")}
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {rows.map((r) => (
            <option key={str(r.key)}>{str(r.key)}</option>
          ))}
          <option value="new">
            {t("New FAQ / content", "سؤال / محتوى جديد")}
          </option>
        </select>
      </label>
      <form
        key={key}
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          await save({ ...f, published: f.published === "on" });
        }}
      >
        <label>
          {t(
            "Content key (FAQ: faq-name)",
            "مفتاح المحتوى (للأسئلة: faq-name)",
          )}
          <input
            name="key"
            defaultValue={key === "new" ? "faq-" : key}
            readOnly={key !== "new"}
            required
            pattern="[a-z0-9-]+"
          />
        </label>
        {["title_en", "title_ar", "body_en", "body_ar"].map((name) => (
          <label key={name}>
            {t(name.replaceAll("_", " "), labels[name])}
            {name.startsWith("body") ? (
              <textarea
                name={name}
                defaultValue={str(entry?.[name])}
                maxLength={8000}
                rows={7}
                dir={name.endsWith("ar") ? "rtl" : "ltr"}
              />
            ) : (
              <input
                name={name}
                defaultValue={str(entry?.[name])}
                maxLength={200}
              />
            )}
          </label>
        ))}
        <label className="check">
          <input
            name="published"
            type="checkbox"
            defaultChecked={!!entry?.published}
          />
          {t("Approved and published", "معتمد ومنشور")}
        </label>
        <p className="small">
          {t(
            "Policies must be approved by the business before publication.",
            "يجب اعتماد السياسات من الشركة قبل نشرها.",
          )}
        </p>
        <button className="button">{t("Save content", "حفظ المحتوى")}</button>
      </form>
    </>
  );
}
function SettingsEditor({
  initial,
  save,
}: {
  initial: Row;
  save: (d: unknown) => Promise<boolean>;
}) {
  const { t } = useStore();
  const [rates, setRates] = useState(
      initial.shipping_zones as { governorate: string; zone: string; fee: number; active: boolean }[],
    ),
    [error, setError] = useState("");
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const d = Object.fromEntries(new FormData(e.currentTarget));
          await save({
            enabled: d.enabled === "on",
            cod_enabled: d.cod_enabled === "on",
            phone: d.phone,
            instagram: d.instagram,
            shipping_zones: rates,
            free_shipping_threshold: d.free_shipping_threshold
              ? parseMoney(String(d.free_shipping_threshold))
              : null,
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label className="check">
        <input
          name="enabled"
          type="checkbox"
          defaultChecked={!!initial.enabled}
        />
        {t("Enable orders", "تفعيل الطلبات")}
      </label>
      <label className="check">
        <input
          name="cod_enabled"
          type="checkbox"
          defaultChecked={!!initial.cod_enabled}
        />
        {t("Enable Cash on Delivery", "تفعيل الدفع عند الاستلام")}
      </label>
      <label>
        {t("Phone / WhatsApp", "الهاتف / واتساب")}
        <input
          name="phone"
          defaultValue={str(initial.phone)}
          required
          pattern="01[0125][0-9]{8}"
          dir="ltr"
        />
      </label>
      <label>
        {t("Instagram handle", "حساب إنستجرام")}
        <input
          name="instagram"
          defaultValue={str(initial.instagram)}
          required
          dir="ltr"
        />
      </label>
      <h2>
        {t("Approved delivery areas & fees", "مناطق التوصيل والرسوم المعتمدة")}
      </h2>
      {rates.map((r, i) => (
        <div className="rate-row" key={i}>
          <label>
            {t("Governorate", "المحافظة")}
            <input
              value={r.governorate}
              onChange={(e) =>
                setRates(
                  rates.map((x, n) =>
                    n === i ? { ...x, governorate: e.target.value } : x,
                  ),
                )
              }
              required
            />
          </label>
          <label>
            {t("Zone label", "اسم المنطقة")}
            <input value={r.zone} onChange={(e) => setRates(rates.map((x, n) => n === i ? { ...x, zone: e.target.value } : x))} />
          </label>
          <label>
            {t("Fee (EGP)", "الرسم (جنيه)")}
            <input
              defaultValue={r.fee / 100}
              inputMode="decimal"
              onBlur={(e) => {
                try {
                  const fee = parseMoney(e.target.value);
                  if (fee === null) throw new Error("INVALID_INPUT");
                  setRates(rates.map((x, n) => (n === i ? { ...x, fee } : x)));
                  setError("");
                } catch {
                  setError("INVALID_INPUT");
                }
              }}
              required
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={r.active} onChange={(e) => setRates(rates.map((x, n) => n === i ? { ...x, active: e.target.checked } : x))} />
            {t("Active", "نشطة")}
          </label>
          <button
            type="button"
            className="text-link"
            onClick={() => setRates(rates.filter((_, n) => n !== i))}
          >
            {t("Remove", "إزالة")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        onClick={() => setRates([...rates, { governorate: "", zone: "", fee: 0, active: false }])}
      >
        {t("Add delivery area", "إضافة منطقة توصيل")}
      </button>
      <label>
        {t("Free shipping threshold (EGP, optional)", "حد الشحن المجاني (جنيه، اختياري)")}
        <input name="free_shipping_threshold" inputMode="decimal" defaultValue={initial.free_shipping_threshold ? Number(initial.free_shipping_threshold) / 100 : ""} />
      </label>
      <p className="small">
        {t(
          "Enter only confirmed coverage and fees. Zero means free shipping. API credentials are configured through environment secrets, never this form.",
          "أدخلي مناطق التغطية والرسوم المؤكدة فقط. الصفر يعني شحنًا مجانيًا. بيانات التكامل تُضبط كأسرار في بيئة التشغيل، ولا تُكتب هنا.",
        )}
      </p>
      <button className="button" disabled={!!error}>
        {t("Save settings", "حفظ الإعدادات")}
      </button>
      {error && <ErrorMessage code={error} />}
    </form>
  );
}
function CouponEditor({
  rows,
  save,
}: {
  rows: Row[];
  save: (id: string, d: unknown) => Promise<boolean>;
}) {
  const { t } = useStore();
  const [id, setId] = useState(""),
    [error, setError] = useState("");
  const r = rows.find((x) => x.id === id);
  return (
    <>
      <DataTable
        rows={rows}
        columns={["code", "type", "value", "active", "used", "usage_limit"]}
      />
      <label>
        {t("Edit code", "تعديل الرمز")}
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">{t("New code", "رمز جديد")}</option>
          {rows.map((x) => (
            <option key={str(x.id)} value={str(x.id)}>
              {str(x.code)}
            </option>
          ))}
        </select>
      </label>
      <form
        key={id}
        className="panel fields"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const f = Object.fromEntries(new FormData(e.currentTarget));
            await save(id, {
              code: f.code,
              type: f.type,
              value: Number(f.value),
              active: f.active === "on",
              starts_at: f.starts_at
                ? new Date(str(f.starts_at)).toISOString()
                : null,
              ends_at: f.ends_at
                ? new Date(str(f.ends_at)).toISOString()
                : null,
              usage_limit: Number(f.usage_limit),
              minimum: parseMoney(str(f.minimum)) || 0,
            });
          } catch {
            setError("INVALID_INPUT");
          }
        }}
      >
        <label>
          {t("Code", "الرمز")}
          <input
            name="code"
            defaultValue={str(r?.code)}
            required
            pattern="[A-Z0-9_-]{3,40}"
          />
        </label>
        <label>
          {t("Type", "النوع")}
          <select name="type" defaultValue={str(r?.type) || "fixed"}>
            <option value="fixed">{t("Fixed (piasters)", "ثابت (قرش)")}</option>
            <option value="percent">
              {t("Percentage (100 = 1%)", "نسبة (100 = 1٪)")}
            </option>
          </select>
        </label>
        {[
          ["value", "Value", "القيمة"],
          ["usage_limit", "Usage limit", "حد الاستخدام"],
        ].map(([name, en, ar]) => (
          <label key={name}>
            {t(en, ar)}
            <input
              type="number"
              name={name}
              min="1"
              step="1"
              required
              defaultValue={str(r?.[name])}
            />
          </label>
        ))}
        <label>
          {t("Minimum order (EGP)", "الحد الأدنى للطلب (جنيه)")}
          <input name="minimum" defaultValue={Number(r?.minimum || 0) / 100} />
        </label>
        {["starts_at", "ends_at"].map((name) => (
          <label key={name}>
            {t(
              name === "starts_at" ? "Starts" : "Ends",
              name === "starts_at" ? "البداية" : "النهاية",
            )}
            <input
              name={name}
              type="datetime-local"
              defaultValue={
                r?.[name]
                  ? new Date(str(r[name])).toISOString().slice(0, 16)
                  : ""
              }
            />
          </label>
        ))}
        <label className="check">
          <input name="active" type="checkbox" defaultChecked={!!r?.active} />
          {t("Active", "نشط")}
        </label>
        <button className="button">{t("Save code", "حفظ الرمز")}</button>
        {error && <ErrorMessage code={error} />}
      </form>
    </>
  );
}
function Users({
  rows,
  save,
}: {
  rows: Row[];
  save: (url: string, method: string, d?: unknown) => Promise<boolean>;
}) {
  const { t } = useStore();
  return (
    <>
      <DataTable rows={rows} columns={["email", "role_id", "active"]} />
      {rows.map((r) => (
        <form
          className="panel input-row"
          key={str(r.id)}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await save("users/" + r.id, "PUT", {
              role: f.get("role"),
              active: f.get("active") === "on",
            });
          }}
        >
          <strong>{str(r.email)}</strong>
          <label>
            {t("Role", "الدور")}
            <select name="role" defaultValue={str(r.role_id)}>
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="support">Support</option>
            </select>
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={!!r.active} />
            {t("Active", "نشط")}
          </label>
          <button className="button secondary">{t("Save", "حفظ")}</button>
          <button
            type="button"
            className="text-link"
            onClick={() => save("sessions/" + r.id, "DELETE")}
          >
            {t("Revoke sessions", "إنهاء الجلسات")}
          </button>
        </form>
      ))}
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const d = Object.fromEntries(new FormData(form));
          if (await save("users", "POST", d)) form.reset();
        }}
      >
        <h2>{t("Add administrator", "إضافة مسؤول")}</h2>
        <label>
          {t("Email", "البريد الإلكتروني")}
          <input name="email" type="email" required />
        </label>
        <label>
          {t("Initial password", "كلمة المرور الأولية")}
          <input
            name="password"
            type="password"
            minLength={12}
            maxLength={72}
            required
            autoComplete="new-password"
          />
        </label>
        <label>
          {t("Role", "الدور")}
          <select name="role">
            <option value="support">Support</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button className="button">
          {t("Create account", "إنشاء الحساب")}
        </button>
      </form>
    </>
  );
}
