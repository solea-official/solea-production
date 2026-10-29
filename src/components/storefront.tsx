"use client";
import Link from "next/link";
import Image from "next/image";
import { homeMedia } from "@/lib/home-media";
import { ProductUsage } from "./product-usage";
import { DistanceSelling } from "./distance-selling";
import { useEffect, useRef, useState } from "react";
import { useStore, ErrorMessage } from "./provider";
import { Icon } from "./brand";
import { Product, StoreData } from "@/lib/types";
import { api, currency, analytics } from "@/lib/api";
export function ProductCard({ product: p }: { product: Product }) {
  const { t, locale } = useStore();
  return (
    <article className="product-card">
      <Link href={"/products/" + p.slug} className="product-photo">
        <img
          src={p.images[0]?.url || "/media/logo.png"}
          alt={t(
            p.images[0]?.alt_en || p.name_en,
            p.images[0]?.alt_ar || p.name_ar,
          )}
          loading="lazy"
          width="650"
          height="813"
        />
        <span className="pill">
          {p.price === null
            ? t("Coming soon", "قريبًا")
            : p.stock > 0
              ? t("Available", "متاح")
              : t("Out of stock", "نفد المخزون")}
        </span>
      </Link>
      <div className="product-card-copy">
        <div>
          <h3>
            <Link href={"/products/" + p.slug}>{t(p.name_en, p.name_ar)}</Link>
          </h3>
          <p>{p.volume}</p>
        </div>
        <span>
          {p.price === null
            ? t("Price Coming Soon", "السعر يُعلن قريبًا")
            : currency(p.price, locale)}
        </span>
      </div>
    </article>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="page-title wrap">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  );
}
export function Newsletter({ enabled }: { enabled: boolean }) {
  const { t, notify } = useStore();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="newsletter">
      <div className="wrap newsletter-grid">
        <div>
          <p className="eyebrow">
            {t("Our next little chapter", "خطوتنا القادمة")}
          </p>
          <h2>{t("Be there for the beginning.", "كوني معنا من البداية.")}</h2>
          <p>
            {t(
              "News from SOLÉA, with a little care.",
              "أخبار SOLÉA، بلمسة من العناية.",
            )}
          </p>
        </div>
        <form
          className="newsletter-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = e.currentTarget;
            try {
              const f = new FormData(form);
              await api("newsletter", "POST", {
                email: f.get("email"),
                consent: f.get("consent") === "on",
              });
              notify(t("You’re on the list.", "تم تسجيلك في القائمة."));
              form.reset();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="newsletter-email">
            {t("Email address", "البريد الإلكتروني")}
          </label>
          <div className="input-row">
            <input
              id="newsletter-email"
              name="email"
              type="email"
              required
              dir="ltr"
              autoComplete="email"
              placeholder="you@example.com"
              disabled={!enabled}
            />
            <button className="button" disabled={busy || !enabled}>
              {t("Keep me updated", "أخبريني بالجديد")}
              <Icon />
            </button>
          </div>
          {enabled ? (
            <label className="check">
              <input type="checkbox" name="consent" required />
              {t(
                "I agree to receive launch news and have read the",
                "أوافق على تلقّي أخبار الإطلاق وقرأت",
              )}{" "}
              <Link href="/privacy">
                {t("privacy policy.", "سياسة الخصوصية.")}
              </Link>
            </label>
          ) : (
            <p className="small">
              {t(
                "Launch updates will open soon.",
                "التسجيل لتحديثات الإطلاق سيتاح قريبًا.",
              )}
            </p>
          )}
          {error && <ErrorMessage code={error} />}
        </form>
      </div>
    </section>
  );
}
export function Home({
  products,
  data,
}: {
  products: Product[];
  data: StoreData;
}) {
  const { t } = useStore();
  const hero = data.content.find((x) => x.key === "hero");
  const faqs = data.content
    .filter((x) => x.key.startsWith("faq-") && x.published)
    .slice(0, 3);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SOLÉA · CARE FROM NATURE</p>
          <h1>
            {t(
              hero?.title_en || "Gentle care for little beginnings.",
              hero?.title_ar || "عناية لطيفة لأجمل البدايات.",
            )}
          </h1>
          <p>{t(hero?.body_en || "", hero?.body_ar || "")}</p>
          <div className="actions">
            <Link className="button" href="/products">
              {t("Discover SOLÉA", "اكتشفي SOLÉA")}
              <Icon />
            </Link>
          </div>
          <span className="hero-footnote">
            {t(
              "OUR FIRST CHAPTER / BABY SHAMPOO / 125 mL",
              "بدايتنا / شامبو الأطفال / 125 مل",
            )}
          </span>
        </div>
        <div className="hero-image">
          <img
            src="/media/product-main-v2.webp"
            alt={t(
              "SOLÉA white pump bottle in soft natural light",
              "عبوة SOLÉA بمضخة بيضاء في إضاءة طبيعية ناعمة",
            )}
            width="900"
            height="1000"
            fetchPriority="high"
          />
          <span className="image-caption">
            {t(
              "A little nature. A little tenderness.",
              "لمسة من الطبيعة. كثير من الحنان.",
            )}
          </span>
        </div>
      </section>
      <div className="promise-bar">
        <span>{t("Botanical inspiration", "إلهام نباتي")}</span>
        <span>{t("Thoughtful formulation", "تركيبة مدروسة")}</span>
        <span>{t("Everyday care", "عناية يومية")}</span>
      </div>
      <section className="section wrap story">
        <p className="eyebrow">{t("The SOLÉA philosophy", "فلسفة SOLÉA")}</p>
        <h2>
          {t(
            "For the smallest moments. With the greatest care.",
            "لأبسط اللحظات، بكل العناية والاهتمام.",
          )}
        </h2>
        <p>
          {t(
            "A simple care routine, inspired by nature and created for quiet everyday moments.",
            "روتين عناية بسيط، مستوحى من الطبيعة ومصمم للحظات اليومية الهادئة.",
          )}
        </p>
        <Link href="/about" className="text-link">
          {t("Our Story", "حكايتنا")}
          <Icon />
        </Link>
      </section>
      <section className="section featured">
        <div className="wrap">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {t("A thoughtful beginning", "بداية مليئة بالاهتمام")}
              </p>
              <h2>{t("Your little essentials.", "احتياجات صغيرك.")}</h2>
            </div>
            <Link href="/products" className="text-link">
              {t("Explore the collection", "اكتشفي المجموعة")}
              <Icon />
            </Link>
          </div>
          <div className="featured-grid">
            {products.slice(0, 1).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
            <div className="featured-copy">
              <span className="number">01 /</span>
              <h2>
                {t(
                  "A little bottle. A lot of thought.",
                  "عبوة صغيرة. اهتمام كبير.",
                )}
              </h2>
              <p>
                {t(
                  "A thoughtfully presented baby shampoo for a calm and simple everyday care routine.",
                  "شامبو أطفال بعناية مدروسة لروتين يومي هادئ وبسيط.",
                )}
              </p>
              {products[0] && (
                <Link className="button" href={"/products/" + products[0].slug}>
                  {t("Explore the product", "اكتشفي المنتج")}
                  <Icon />
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>
      <section className="ritual">
        <img
          src="/media/lifestyle.webp"
          alt={t(
            "A soft towel, wooden baby brush and ceramic bowl",
            "منشفة ناعمة وفرشاة خشبية ووعاء خزفي",
          )}
          width="850"
          height="900"
          loading="lazy"
        />
        <div>
          <p className="eyebrow">
            {t("The everyday, made tender", "حنان في تفاصيل كل يوم")}
          </p>
          <h2>
            {t("Little rituals. Lasting moments.", "تفاصيل صغيرة. لحظات تبقى.")}
          </h2>
          <p>
            {t(
              "The soft towel. The close cuddle. The time you make for each other. Care lives in the little things.",
              "منشفة ناعمة، وحضن دافئ، ووقت يجمعكما. العناية تسكن التفاصيل الصغيرة.",
            )}
          </p>
          <Link href="/about" className="text-link">
            {t("Why SOLÉA", "لماذا SOLÉA؟")}
            <Icon />
          </Link>
        </div>
      </section>
      <section className="section wrap">
        <div className="section-heading">
          <h2>{t("From our world.", "من عالمنا.")}</h2>
          <a
            className="text-link"
            href={"https://instagram.com/" + data.settings.instagram}
          >
            <bdi>@{data.settings.instagram}</bdi>
          </a>
        </div>
        <div className="social-grid approved-gallery">
          {homeMedia.map((img) => (
            <a
              key={img.src}
              href={"https://instagram.com/" + data.settings.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("Visit SOLÉA on Instagram", "زيارة SOLÉA على إنستجرام")}
            >
              <Image
                src={img.src}
                alt={t(img.en, img.ar)}
                width={img.width}
                height={img.height}
                sizes="(max-width: 600px) 90vw, (max-width: 900px) 45vw, 30vw"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      </section>
      <section className="section wrap faq-preview">
        <div>
          <p className="eyebrow">
            {t("A little reassurance", "إجابات تطمئنك")}
          </p>
          <h2>
            {t(
              "Good questions. Thoughtful answers.",
              "أسئلتك مهمّة. وإجاباتنا واضحة.",
            )}
          </h2>
          <Link href="/faq" className="text-link">
            {t("All questions", "كل الأسئلة")}
            <Icon />
          </Link>
        </div>
        <div>
          {faqs.map((f) => (
            <details key={f.key}>
              <summary>{t(f.title_en, f.title_ar)}</summary>
              <p>{t(f.body_en, f.body_ar)}</p>
            </details>
          ))}
        </div>
      </section>
      <Newsletter
        enabled={!!data.content.find((x) => x.key === "privacy")?.published}
      />
    </>
  );
}
export function Catalog({
  products,
  data,
}: {
  products: Product[];
  data: StoreData;
}) {
  const { t } = useStore();
  const [category, setCategory] = useState(""),
    [sort, setSort] = useState("featured"),
    [search, setSearch] = useState("");
  const filtered = products
    .filter(
      (p) =>
        (!category || p.category_id === category) &&
        [p.name_en, p.name_ar].some((n) =>
          n.toLowerCase().includes(search.toLowerCase()),
        ),
    )
    .sort((a, b) =>
      sort === "price"
        ? (a.price ?? Infinity) - (b.price ?? Infinity)
        : sort === "name"
          ? a.name_en.localeCompare(b.name_en)
          : 0,
    );
  return (
    <>
      <PageTitle
        eyebrow={t("The collection", "المجموعة")}
        title={t("Care, beautifully simple.", "عناية ببساطة جميلة.")}
        description={t(
          "Thoughtful essentials for little beginnings.",
          "منتجات مختارة لأجمل البدايات.",
        )}
      />
      <section className="wrap section compact">
        <div className="filters">
          <label>
            {t("Find a product", "ابحثي عن منتج")}
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            {t("Category", "الفئة")}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{t("All", "الكل")}</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.name_en, c.name_ar)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Sort", "الترتيب")}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="featured">{t("Featured", "المميّزة")}</option>
              <option value="price">
                {t("Price: low to high", "السعر: من الأقل للأعلى")}
              </option>
              <option value="name">{t("Name", "الاسم")}</option>
            </select>
          </label>
        </div>
        <div className="catalog-grid">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="empty">
            {t("No products match your search.", "لا توجد منتجات تطابق بحثك.")}
          </p>
        )}
      </section>
    </>
  );
}

export function ProductDetail({
  product: p,
  data,
}: {
  product: Product;
  data: StoreData;
}) {
  const { t, locale, notify } = useStore();
  const [index, setIndex] = useState(0),
    [qty, setQty] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const images = p.slug === "baby-shampoo" ? p.images.slice(0, 4) : p.images;
  const image = images[index] || images[0];
  useEffect(() => analytics("view_product", p.id), [p.id]);
  return (
    <>
      <div className="wrap breadcrumb">
        <Link href="/products">{t("Products", "المنتجات")}</Link>
        <span>/</span>
        {t(p.name_en, p.name_ar)}
      </div>
      <section className="wrap product-detail">
        <div className="gallery">
          <button
            className="gallery-main"
            aria-label={t("Zoom product image", "تكبير صورة المنتج")}
            onClick={() => dialog.current?.showModal()}
          >
            <img
              key={image?.id}
              src={image?.url || "/media/logo.png"}
              alt={t(image?.alt_en || p.name_en, image?.alt_ar || p.name_ar)}
              width="800"
              height="1000"
            />
          </button>
          <div className="thumbnails">
            {images.map((img, i) => (
              <button
                key={img.id}
                aria-pressed={index === i}
                onClick={() => setIndex(i)}
                aria-label={t(img.alt_en, img.alt_ar)}
              >
                <img src={img.url} alt="" width="88" height="88" />
              </button>
            ))}
          </div>
          <dialog ref={dialog} className="zoom">
            <button
              className="icon-button"
              onClick={() => dialog.current?.close()}
              aria-label={t("Close", "إغلاق")}
            >
              <Icon name="close" />
            </button>
            <img
              key={image?.id}
              src={image?.url || "/media/logo.png"}
              alt={t(image?.alt_en || p.name_en, image?.alt_ar || p.name_ar)}
              width="1000"
              height="1250"
            />
          </dialog>
        </div>
        <div className="detail-copy">
          <p className="eyebrow">SOLÉA · CARE FROM NATURE</p>
          <h1>{t(p.name_en, p.name_ar)}</h1>
          <p className="volume">
            {p.volume}
            {p.slug === "baby-shampoo" && (
              <>
                {" "}
                ·{" "}
                {t(
                  "Baby Shampoo / Hair & Body Wash",
                  "شامبو الأطفال / غسول الشعر والجسم",
                )}
              </>
            )}
          </p>
          <p>{t(p.description_en, p.description_ar)}</p>
          <div className="price">
            {p.price === null
              ? t("Price Coming Soon", "السعر يُعلن قريبًا")
              : currency(p.price, locale)}
          </div>
          <p className="small">
            {p.price === null
              ? t("Be there for our first chapter.", "كوني معنا في البداية.")
              : p.stock > 0
                ? t("In stock", "متوفّر")
                : t("Out of stock", "نفد المخزون")}
          </p>
          <div className="purchase">
            <div className="quantity">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                disabled={qty === 1}
                aria-label={t("Decrease quantity", "تقليل الكمية")}
              >
                −
              </button>
              <output>{qty}</output>
              <button
                onClick={() => setQty(Math.min(99, qty + 1))}
                disabled={qty >= Math.min(99, p.stock)}
                aria-label={t("Increase quantity", "زيادة الكمية")}
              >
                +
              </button>
            </div>
            <button
              className="button"
              disabled={
                busy ||
                p.price === null ||
                p.stock < qty ||
                !data.settings.enabled
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("cart", "POST", { productId: p.id, quantity: qty });
                  analytics("add_to_cart", p.id);
                  notify(t("Added to your bag.", "تمت الإضافة إلى سلّتك."));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Add to bag", "أضيفي إلى السلة")}
              <Icon name="bag" />
            </button>
          </div>
          {error && <ErrorMessage code={error} />}
          <Link href="/cart" className="text-link">
            {t("View your bag", "عرض السلة")}
            <Icon />
          </Link>
          <ProductUsage en={p.usage_en} ar={p.usage_ar} />
          {[
            [t("Warnings", "تحذيرات"), t(p.warnings_en, p.warnings_ar)],
          ].map(([title, body]) => (
            <details key={title}>
              <summary>{title}</summary>
              <p>{body}</p>
            </details>
          ))}
          <details>
            <summary>{t("Delivery & returns", "التوصيل والإرجاع")}</summary>
            <p>
              {t(
                "Shipping is configured by area. Returns are accepted only if the product has not been opened.",
                "يُحدّد الشحن حسب المنطقة. يُقبل الإرجاع فقط إذا لم تُفتح العبوة.",
              )}
            </p>
            <Link href="/shipping-policy">
              {t("Shipping policy", "سياسة الشحن")}
            </Link>{" "}
            · <Link href="/returns">{t("Returns", "الإرجاع")}</Link>
          </details>
          <details>
            <summary>{t("Product questions", "أسئلة عن المنتج")}</summary>
            <Link href="/faq">
              {t(
                "Read our frequently asked questions",
                "اقرئي الأسئلة الشائعة",
              )}
            </Link>
          </details>
        </div>
      </section>
    </>
  );
}
export function Information({ page, data }: { page: string; data: StoreData }) {
  const { t, locale } = useStore();
  const entry = data.content.find((x) => x.key === page);
  const legalPages = ["privacy", "terms", "returns", "shipping-policy", "distance-selling"];
  if (page === "contact")
    return (
      <>
        <PageTitle
          eyebrow={t("Let’s connect", "تواصلي معنا")}
          title={t("A little question?", "لديكِ سؤال؟")}
          description={t(
            "We would love to hear from you.",
            "يسعدنا تواصلك معنا.",
          )}
        />
        <div className="wrap contact-grid section compact">
          <a
            className="contact-card"
            href={"tel:+20" + data.settings.phone.slice(1)}
            onClick={() => analytics("contact")}
          >
            <Icon name="phone" />
            <h2>{t("Call us", "اتصلي بنا")}</h2>
            <bdi>{data.settings.phone}</bdi>
          </a>
          <a
            className="contact-card blue"
            href={"https://wa.me/20" + data.settings.phone.slice(1)}
            onClick={() => analytics("whatsapp_click")}
          >
            <Icon />
            <h2>{t("WhatsApp", "واتساب")}</h2>
            <bdi>{data.settings.phone}</bdi>
          </a>
          <a
            className="contact-card pink"
            href={"https://instagram.com/" + data.settings.instagram}
          >
            <h2>{t("Instagram", "إنستجرام")}</h2>
            <bdi>@{data.settings.instagram}</bdi>
          </a>
        </div>
      </>
    );
  if (page === "faq")
    return (
      <>
        <PageTitle
          title={t("Thoughtful answers.", "إجابات واضحة.")}
          eyebrow={t("Frequently asked questions", "الأسئلة الشائعة")}
        />
        <div className="wrap narrow section compact">
          {data.content
            .filter((x) => x.key.startsWith("faq-") && x.published)
            .map((x) => (
              <details key={x.key}>
                <summary>{t(x.title_en, x.title_ar)}</summary>
                <p>{t(x.body_en, x.body_ar)}</p>
              </details>
            ))}
        </div>
      </>
    );
  if (page === "about")
    return (
      <>
        <PageTitle title={t("Our Story", "حكايتنا")} eyebrow="SOLÉA" />
        <section className="section wrap narrow compact about-story" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
          <p className="about-story-lead">
            {t("Born from a mother’s love. Created with every child’s needs in mind.", "وُلدت من حب أم. وصُنعت لتراعي احتياجات كل طفل.")}
          </p>
          <div className="about-story-body">
            <p>{t("Soléa’s story began with motherhood.", "بدأت حكاية Soléa مع الأمومة.")}</p>
            <p>
              {t("As a mother, I began to question the products I used for my baby and look for gentle, trustworthy, and thoughtfully crafted care products. What started as a personal search gradually became a dream: to create a brand that cares not only for our own children, but for the unique needs of every child.", "كأم، بدأت أتساءل عن المنتجات التي أستخدمها لطفلي، وأبحث عن منتجات عناية لطيفة، جديرة بالثقة، ومصنوعة بعناية مدروسة. وما بدأ كبحث شخصي تحوّل تدريجيًا إلى حلم: أن نؤسس علامة تهتم ليس فقط بأطفالنا، بل بالاحتياجات الفريدة لكل طفل.")}
            </p>
            <p>
              {t("Because we know that every child is different. For children with special needs and their families, everyday care can carry an even deeper meaning—one that requires greater sensitivity, understanding, and trust.", "لأننا نعرف أن كل طفل مختلف. وبالنسبة للأطفال ذوي الاحتياجات الخاصة وأسرهم، قد تحمل العناية اليومية معنى أعمق، يتطلب مزيدًا من مراعاة احتياجاتهم، والتفهّم، والثقة.")}
            </p>
            <p>
              {t("That is why we created Soléa with love and care, keeping children with different needs and their families in mind.", "لهذا أنشأنا Soléa بحب وعناية، واضعين في اعتبارنا الأطفال باختلاف احتياجاتهم وأسرهم.")}
            </p>
            <p>
              {t("Soléa Baby was created to bring together nature-inspired ingredients, thoughtful formulation, and a mother’s care, with the delicate needs of babies and children at the heart of everything we do.", "أُنشئت Soléa Baby لتجمع بين مكونات مستوحاة من الطبيعة، وتركيبة مدروسة، وعناية أم، مع وضع احتياجات الرضّع والأطفال الدقيقة في قلب كل ما نقوم به.")}
            </p>
            <p>
              {t("For us, care is about more than simply cleansing.", "بالنسبة لنا، العناية أكثر من مجرد تنظيف.")}
              <br />
              {t("It means being gentle, building trust, and respecting every child’s unique world.", "إنها تعني اللطف، وبناء الثقة، واحترام عالم كل طفل الفريد.")}
            </p>
          </div>
          <p className="about-story-emphasis">
            {t("Clean ingredients. Gentle care. A mother’s love.", "مكونات نقية. عناية لطيفة. حب أم.")}
          </p>
          <p className="about-story-reflection">
            {t("Because we know that", "لأننا نعرف أن")}
            <br />
            {t("every mother wants the very best for her baby. And that is exactly the feeling with which we created Soléa.", "كل أم تريد الأفضل لطفلها. وهذا هو الشعور نفسه الذي أنشأنا به Soléa.")}
          </p>
          <p className="about-story-closing">
            <strong>Soléa Baby</strong>
            <span>{t("Every child is special. Every touch, with love.", "كل طفل مميّز. وكل لمسة، بحب.")}</span>
          </p>
          <img
            className="about-photo"
            src="/media/box.png"
            alt={t("SOLÉA kraft packaging", "علبة SOLÉA الكرافت")}
            width="1000"
            height="900"
          />
          <Link href="/products" className="button">
            {t("Explore our products", "اكتشفي منتجاتنا")}
            <Icon />
          </Link>
        </section>
      </>
    );
  return (
    <>
      <PageTitle
        title={t(
          entry?.title_en || "Not found",
          entry?.title_ar || "الصفحة غير موجودة",
        )}
        eyebrow="SOLÉA"
      />
      <section className={`section wrap narrow compact${legalPages.includes(page) ? " legal-page" : ""}`}>
        {legalPages.includes(page) && (
          <>
            <nav className="legal-nav" aria-label={t("Legal pages", "الصفحات القانونية")}>
              {[
                ["/privacy", "Privacy", "الخصوصية"],
                ["/terms", "Terms", "الشروط"],
                ["/returns", "Returns", "الإرجاع"],
                ["/shipping-policy", "Shipping", "الشحن"],
                ["/distance-selling", "Distance selling", "البيع عن بُعد"],
              ].map(([href, en, ar]) => (
                <Link key={href} href={href} aria-current={href === `/${page}` ? "page" : undefined}>
                  {t(en, ar)}
                </Link>
              ))}
            </nav>
            {!entry?.published && (
              <p className="legal-draft">
                {t(
                  "Draft placeholder — final business and legal approval is still required.",
                  "مسودة مؤقتة — لا تزال بحاجة إلى اعتماد الشركة والمراجعة القانونية النهائية.",
                )}
              </p>
            )}
          </>
        )}
        {page === "distance-selling" ? (
          <DistanceSelling entry={entry} />
        ) : (
          <p className="prose">{t(entry?.body_en || "", entry?.body_ar || "")}</p>
        )}
      </section>
    </>
  );
}
