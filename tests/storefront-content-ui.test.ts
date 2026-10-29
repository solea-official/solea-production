import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";
import policies from "../src/lib/legal-content.json";
import approved from "../src/lib/approved-storefront-content.json";
import { homeMedia } from "../src/lib/home-media";

async function fixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), "solea-content-ui-"));
  await build({
    entryPoints: ["tests/browser/entry.tsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(temporary, "app.js"),
    jsx: "automatic",
    alias: {
      "next/link": path.resolve("tests/browser/link.tsx"),
      "next/image": path.resolve("tests/browser/image.tsx"),
      "next/navigation": path.resolve("tests/browser/navigation.ts"),
    },
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const app = await readFile(path.join(temporary, "app.js")),
    css = await readFile("src/app/globals.css", "utf8");
  const browser = await playwright.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (await chromium.executablePath()),
    args: process.env.CHROMIUM_PATH ? [] : chromium.args.filter((x) => x !== "--disable-web-security"),
    headless: true,
  });
  const context = await browser.newContext({ reducedMotion: "reduce" }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let published = false;
  let quantity = 0;
  const cartCalls: unknown[] = [];
  await context.route("http://localhost:3000/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/test.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: app,
      });
    if (url.pathname === "/api/cart") {
      if (route.request().method() !== "GET") {
        const body = route.request().postDataJSON();
        cartCalls.push(body);
        quantity = route.request().method() === "POST" ? quantity + body.quantity : body.quantity;
      }
      const subtotal = quantity * 24999, discount = Math.floor(quantity / 2) * 4999;
      return route.fulfill({ json: { items: quantity ? [{ id: "fixture-product", slug: "baby-shampoo", name_en: "SOLÉA Baby Shampoo", name_ar: "شامبو SOLÉA للأطفال", volume: "125 mL", image: "/media/product-main-v2.webp", price:24999, quantity, stock:10, status:"active" }] : [], subtotal, discount, total:subtotal-discount, valid:quantity>0 } });
    }
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({
        status: url.pathname === "/api/account/me" ? 401 : 200,
        json: { csrf: "ui-only", items: [], subtotal: 0 },
      });
    if (url.pathname === "/_next/image" || url.pathname.startsWith("/media/")) {
      const src =
        url.pathname === "/_next/image"
          ? url.searchParams.get("url")!
          : url.pathname;
      assert.ok(src.startsWith("/media/") && !src.includes(".."));
      return route.fulfill({
        contentType: src.endsWith(".jpg")
          ? "image/jpeg"
          : src.endsWith(".webp")
            ? "image/webp"
            : "image/png",
        body: await readFile(path.join("public", src)),
      });
    }
    const locale = (await route.request().allHeaders()).cookie?.includes(
      "lang=ar",
    )
      ? "ar"
      : "en";
    const data = {
      content: [
        ...Object.entries(policies)
          .filter(([key]) => key !== "distance-selling")
          .map(([key, p]) => ({ key, ...p, published: true })),
        {
          key: "distance-selling",
          title_en: "Distance selling",
          title_ar: "البيع عن بُعد",
          body_en: policies["distance-selling"].body_en,
          body_ar: policies["distance-selling"].body_ar,
          published,
        },
      ],
      categories: [],
      settings: {
        enabled: true,
        cod_enabled: true,
        phone: "01039010190",
        instagram: "soleababy.egypt",
        shipping_zones: [],
        instapay: { enabled: false, account: "", qrUrl: "" },
        vodafoneCash: { enabled: false, number: "", qrUrl: "" },
        paymob: { enabled: false },
      },
    };
    const product = {
      id: "fixture-product",
      sku: "SOL-125",
      slug: "baby-shampoo",
      name_en: "SOLÉA Baby Shampoo",
      name_ar: "شامبو SOLÉA للأطفال",
      description_en: "",
      description_ar: "",
      usage_en: approved.directions.en.join("\n\n"),
      usage_ar: approved.directions.ar.join("\n\n"),
      warnings_en: "For external use only.",
      warnings_ar: "للاستخدام الخارجي فقط.",
      price: 24999,
      stock: 10,
      status: "active",
      volume: "125 mL",
      images: [
        {
          id: "fixture-image",
          url: homeMedia[1].src,
          alt_en: homeMedia[1].en,
          alt_ar: homeMedia[1].ar,
          position: 0,
        },
      ],
    };
    const fixture = { locale, data, products: [product], user: null };
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script src="/test.js"></script></body></html>`,
    });
  });
  return {
    context,
    page,
    errors,
    cartCalls,
    setPublished: () => {
      published = true;
    },
    close: async () => {
      await browser.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

test("new homepage originals, optimized responsive markup, social links and exact bilingual directions render without overflow", async () => {
  const f = await fixture();
  try {
    for (const width of [1440, 768, 390])
      for (const lang of ["en", "ar"] as const) {
        await f.page.setViewportSize({ width, height: 900 });
        await f.context.addCookies([
          { name: "lang", value: lang, url: "http://localhost:3000" },
        ]);
        await f.page.goto("http://localhost:3000/");
        const hero = f.page.locator(".hero-image img");
        await expect(hero).toHaveAttribute(
          "src",
          "/media/product-main-v2.webp",
        );
        await expect(hero).toHaveAttribute("width", "900");
        await expect(hero).toHaveAttribute("height", "1000");
        await expect(hero).toHaveAttribute("fetchpriority", "high");
        assert.equal(
          await hero.evaluate((el) => getComputedStyle(el).objectFit),
          "contain",
        );
        await expect
          .poll(() =>
            hero.evaluate((el) => (el as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
        if (process.env.UI_SCREENSHOT_DIR) {
          await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await f.page
            .locator(".hero")
            .screenshot({
              path: `${process.env.UI_SCREENSHOT_DIR}/hero-${lang}-${width}.png`,
            });
        }
        await f.page.locator(".approved-gallery").scrollIntoViewIfNeeded();
        const imgs = f.page.locator(".approved-gallery img");
        await expect(imgs).toHaveCount(3);
        for (let i = 0; i < 3; i++) {
          await expect(imgs.nth(i)).toHaveAttribute("alt", homeMedia[i][lang]);
          await expect(imgs.nth(i)).toHaveAttribute("srcset", /_next\/image/);
          await expect
            .poll(() =>
              imgs
                .nth(i)
                .evaluate((el) => (el as HTMLImageElement).naturalWidth),
            )
            .toBeGreaterThan(0);
          assert.equal(
            new URL(
              (await imgs.nth(i).getAttribute("src"))!,
              "http://localhost:3000",
            ).searchParams.get("url"),
            homeMedia[i].src,
          );
          assert.equal(
            await imgs.nth(i).evaluate((el) => getComputedStyle(el).objectFit),
            "cover",
          );
          assert.equal(
            await imgs
              .nth(i)
              .evaluate((el) => getComputedStyle(el).objectPosition),
            "50% 50%",
          );
        }
        const frames = await f.page
          .locator(".approved-gallery > a")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                bottom: r.bottom,
              };
            }),
          );
        for (const frame of frames) {
          assert.ok(Math.abs(frame.width - frames[0].width) < 1);
          assert.ok(Math.abs(frame.height - frames[0].height) < 1);
          assert.ok(Math.abs(frame.width / frame.height - 4 / 5) < 0.001);
          if (width > 700) {
            assert.ok(Math.abs(frame.y - frames[0].y) < 1);
            assert.ok(Math.abs(frame.bottom - frames[0].bottom) < 1);
          }
        }
        if (width <= 700) {
          assert.ok(
            Math.abs(
              frames[1].y - frames[0].bottom - (frames[2].y - frames[1].bottom),
            ) < 1,
          );
        } else {
          const sorted = [...frames].sort((a, b) => a.x - b.x);
          assert.ok(
            Math.abs(
              sorted[1].x -
                sorted[0].x -
                sorted[0].width -
                (sorted[2].x - sorted[1].x - sorted[1].width),
            ) < 1,
          );
        }
        const ig = f.page.locator("footer .footer-social-links a").nth(0),
          tik = f.page.locator("footer .footer-social-links a").nth(2);
        await expect(ig).toHaveAttribute(
          "href",
          "https://www.instagram.com/soleababy.egypt/",
        );
        await expect(tik).toHaveAttribute(
          "href",
          "https://www.tiktok.com/@soleababy.egypt",
        );
        await expect(
          f.page.locator("footer .footer-social-links a"),
        ).toHaveCount(4);
        await expect(
          f.page.locator("footer .footer-social-links a").nth(1),
        ).toHaveAttribute(
          "href",
          "https://www.facebook.com/share/1Eqf2ofj4V/?mibextid=wwXIfr",
        );
        await expect(
          f.page.locator("footer .footer-social-links a").nth(3),
        ).toHaveAttribute("href", "https://wa.me/201039010190");
        const headings = f.page.locator("footer h4");
        await expect(headings).toHaveCount(5);
        for (const heading of await headings.all())
          assert.equal(
            await heading.evaluate((el) => getComputedStyle(el).fontWeight),
            "700",
          );
        for (const link of await f.page
          .locator("footer .footer-social-links a")
          .all()) {
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", "noopener noreferrer");
          await expect(link.locator("svg")).toHaveCount(1);
          assert.ok(await link.getAttribute("aria-label"));
          assert.ok(await link.getAttribute("title"));
        }
        assert.equal(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (process.env.UI_SCREENSHOT_DIR) {
          await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await f.page.locator(".approved-gallery").screenshot({
            path: `${process.env.UI_SCREENSHOT_DIR}/world-${lang}-${width}.png`,
          });
          await f.page.locator("footer").screenshot({
            path: `${process.env.UI_SCREENSHOT_DIR}/footer-${lang}-${width}.png`,
          });
        }
        await f.page.goto("http://localhost:3000/products/baby-shampoo");
        await f.page.locator(".product-usage summary").click();
        const usage = f.page.locator(".product-usage");
        assert.deepEqual(
          await usage.locator("summary,p,h3").allTextContents(),
          approved.directions[lang],
        );
        const bounds = await usage.boundingBox();
        assert.ok(
          bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
        );
        await expect(usage).toHaveAttribute(
          "dir",
          lang === "ar" ? "rtl" : "ltr",
        );
        assert.equal(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (process.env.UI_SCREENSHOT_DIR) {
          await f.page.screenshot({
            path: `${process.env.UI_SCREENSHOT_DIR}/product-viewport-${lang}-${width}.png`,
          });
          await usage.screenshot({
            path: `${process.env.UI_SCREENSHOT_DIR}/usage-${lang}-${width}.png`,
          });
        }
      }
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});

test("distance-selling draft stays unpublished; approved CMS copy has bilingual headings and only active methods", async () => {
  const f = await fixture();
  try {
    await f.page.goto("http://localhost:3000/distance-selling");
    await expect(f.page.locator(".legal-draft")).toBeVisible();
    await expect(f.page.locator(".distance-selling-content")).not.toContainText(
      "14 days",
    );
    f.setPublished();
    for (const lang of ["en", "ar"] as const) {
      await f.context.addCookies([
        { name: "lang", value: lang, url: "http://localhost:3000" },
      ]);
      await f.page.goto("http://localhost:3000/distance-selling");
      await expect(f.page.locator(".legal-draft")).toHaveCount(0);
      assert.deepEqual(
        await f.page.locator(".distance-selling-content h2").allTextContents(),
        policies["distance-selling"][lang === "en" ? "body_en" : "body_ar"]
          .split(/\n\s*\n/)
          .filter((b) => /^\d+\.\s/.test(b)),
      );
      await expect(
        f.page.locator(".available-payment-methods"),
      ).not.toContainText(/Paymob|Vodafone|InstaPay/);
      await expect(
        f.page.locator('.distance-selling-content a[href="tel:+201039010190"]'),
      ).toHaveCount(1);
      await expect(
        f.page.locator(
          '.distance-selling-content a[href="https://wa.me/201039010190"]',
        ),
      ).toHaveCount(1);
      await f.page.setViewportSize({ width: 390, height: 900 });
      assert.equal(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const legalBounds = await f.page.locator(".legal-page").boundingBox();
      assert.ok(
        legalBounds &&
          legalBounds.x >= -1 &&
          legalBounds.x + legalBounds.width <= 391,
      );
      if (process.env.UI_SCREENSHOT_DIR)
        await f.page.locator(".legal-page").screenshot({
          path: `${process.env.UI_SCREENSHOT_DIR}/legal-${lang}.png`,
        });
    }
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});


test("bundle card adds two in one action, persists in bag, and returns to standard pricing for one bottle", async () => {
  const f = await fixture();
  try {
    await f.page.setViewportSize({width:390,height:900});
    await f.page.goto("http://localhost:3000/products/baby-shampoo");
    const offer=f.page.locator(".bundle-offer");
    await expect(offer).toContainText("449.99");
    await expect(offer).not.toContainText("499.99");
    await offer.getByRole("button").click();
    await expect(offer.getByRole("button")).toHaveAttribute("aria-pressed","true");
    await expect(f.page.locator(".quantity output")).toHaveText("2");
    await expect.poll(()=>f.cartCalls.length).toBe(1);
    assert.deepEqual(f.cartCalls[0],{productId:"fixture-product",quantity:2});
    await f.page.goto("http://localhost:3000/cart");
    await expect(f.page.locator(".summary-card")).toContainText("449.99");
    await expect(f.page.locator(".summary-card")).toContainText("49.99");
    await f.page.getByRole("button",{name:"Decrease quantity"}).click();
    await expect(f.page.locator(".summary-card")).toContainText("249.99");
    await expect(f.page.locator(".summary-card")).not.toContainText("Bundle discount");
    assert.deepEqual(f.errors,[]);
  } finally { await f.close(); }
});

test("all three complete policies render their full English and Arabic source with RTL and no placeholders",async()=>{
  const f=await fixture();f.setPublished();
  try {
    for(const width of [390,768,1440]) for(const lang of ["en","ar"] as const) for(const [key,p] of Object.entries(policies)) {
      await f.page.setViewportSize({width,height:900});
      await f.context.addCookies([{name:"lang",value:lang,url:"http://localhost:3000"}]);
      await f.page.goto("http://localhost:3000/"+key);
      await expect(f.page.locator(".legal-draft")).toHaveCount(0);
      const body=f.page.locator(".distance-selling-content");
      await expect(body).toHaveAttribute("dir",lang==="ar"?"rtl":"ltr");
      for(const block of p[lang==="en"?"body_en":"body_ar"].split(/\n\s*\n/)) await expect(body).toContainText(block);
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.UI_SCREENSHOT_DIR && width===390) await f.page.screenshot({path:`${process.env.UI_SCREENSHOT_DIR}/${key}-${lang}-mobile.png`});
    }
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});
