import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";
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
  await context.route("http://localhost:3000/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/test.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: app,
      });
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
        {
          key: "distance-selling",
          title_en: "Distance selling",
          title_ar: "البيع عن بُعد",
          body_en: approved.distanceSelling.en
            .map((s) => s.join("\n\n"))
            .join("\n\n"),
          body_ar: approved.distanceSelling.ar
            .map((s) => s.join("\n\n"))
            .join("\n\n"),
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
      price: null,
      stock: 0,
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
        await expect(hero).toHaveAttribute("alt", homeMedia[0][lang]);
        await expect.poll(() => hero.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        if (process.env.UI_SCREENSHOT_DIR) {
          await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await f.page.locator(".hero").screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/hero-${lang}-${width}.png` });
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
            "contain",
          );
        }
        const ig = f.page.locator("footer .footer-social-links a").nth(0),
          tik = f.page.locator("footer .footer-social-links a").nth(1);
        await expect(ig).toHaveAttribute(
          "href",
          "https://www.instagram.com/soleababy.egypt/",
        );
        await expect(tik).toHaveAttribute(
          "href",
          "https://www.tiktok.com/@soleababy.egypt",
        );
        for (const link of [ig, tik]) {
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
          await f.page
            .locator(".approved-gallery")
            .screenshot({
              path: `${process.env.UI_SCREENSHOT_DIR}/world-${lang}-${width}.png`,
            });
          await f.page
            .locator("footer")
            .screenshot({
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
        assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
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
          await f.page.screenshot({path: `${process.env.UI_SCREENSHOT_DIR}/product-viewport-${lang}-${width}.png`});
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
        approved.distanceSelling[lang].map((s) => s[0]),
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
      assert.ok(legalBounds && legalBounds.x >= -1 && legalBounds.x + legalBounds.width <= 391);
      if (process.env.UI_SCREENSHOT_DIR)
        await f.page
          .locator(".legal-page")
          .screenshot({
            path: `${process.env.UI_SCREENSHOT_DIR}/legal-${lang}.png`,
          });
    }
    assert.deepEqual(f.errors, []);
  } finally {
    await f.close();
  }
});
