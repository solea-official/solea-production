import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { build } from "esbuild";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, engine, route } from "../tests/helpers";
await import("./seed");
const { products } = await import("../src/server/catalog");
const { storeData } = await import("../src/server/store");
const { admin } = await import("../src/server/security");
const adminPassword = "BrowserA1" + randomBytes(10).toString("hex");
await db.query(
  "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
  ["ui@example.invalid", await bcrypt.hash(adminPassword, 4)],
);
await mkdir("var/ui", { recursive: true });
await build({
  entryPoints: ["tests/browser/entry.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "var/ui/app.js",
  jsx: "automatic",
  alias: {
    "next/link": path.resolve("tests/browser/link.tsx"),
    "next/navigation": path.resolve("tests/browser/navigation.ts"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const browser = await playwright.launch({
  executablePath:
    process.env.CHROMIUM_PATH || (await chromium.executablePath()),
  args: chromium.args.filter((arg) => arg !== "--disable-web-security"),
  headless: true,
});
const context = await browser.newContext();
const errors: string[] = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const css = await readFile("src/app/globals.css", "utf8");
const app = await readFile("var/ui/app.js");
await context.route("http://localhost:3000/**", async (r) => {
  try {
    const request = r.request(),
      url = new URL(request.url()),
      h = await request.allHeaders();
    if (url.pathname.startsWith("/api/")) {
      const p = url.pathname.slice(5).split("/");
      const req = new NextRequest(url.href, {
        method: request.method(),
        headers: h,
        body: request.postDataBuffer()
          ? new Uint8Array(request.postDataBuffer()!)
          : undefined,
      });
      const fn = route[
        request.method() as keyof typeof route
      ] as typeof route.GET;
      const res = await fn(req, { params: Promise.resolve({ path: p }) });
      if (!res.ok)
        console.log(
          "API rejection",
          url.pathname,
          res.status,
          await res.clone().text(),
        );
      await r.fulfill({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: Buffer.from(await res.arrayBuffer()),
      });
      return;
    }
    if (url.pathname === "/test.js") {
      await r.fulfill({ contentType: "application/javascript", body: app });
      return;
    }
    if (url.pathname.startsWith("/media/")) {
      const file = await readFile(path.join("public", url.pathname));
      await r.fulfill({
        contentType: url.pathname.endsWith(".png") ? "image/png" : "image/webp",
        body: file,
      });
      return;
    }
    const locale = h.cookie?.includes("lang=ar") ? "ar" : "en";
    let user = null;
    if (url.pathname.startsWith("/admin/")) {
      try {
        user = (await admin(new NextRequest(url.href, { headers: h }))).user;
      } catch {
        await r.fulfill({ status: 302, headers: { location: "/admin" } });
        return;
      }
    }
    const data = {
      products: await products(),
      data: await storeData(),
      locale,
      user,
    };
    await r.fulfill({
      contentType: "text/html",
      body:
        '<!doctype html><html lang="' +
        locale +
        '" dir="' +
        (locale === "ar" ? "rtl" : "ltr") +
        '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
        css +
        '</style></head><body><div id="root"></div><script>window.fixture=' +
        JSON.stringify(data).replace(/</g, "\\u003c") +
        '</script><script src="/test.js"></script></body></html>',
    });
  } catch (e) {
    errors.push(String(e));
    await r.fulfill({ status: 500, body: "Failure" });
  }
});
let checks = 0;
const publicRoutes = process.env.QUICK_UI
  ? []
  : [
      "/",
      "/products",
      "/products/baby-shampoo",
      "/ingredients",
      "/about",
      "/cart",
      "/checkout",
      "/contact",
      "/faq",
      "/shipping-policy",
      "/returns",
      "/privacy",
      "/terms",
      "/track-order",
    ];
for (const width of process.env.QUICK_UI ? [] : [1440, 768, 390]) {
  await page.setViewportSize({ width, height: 960 });
  for (const route of publicRoutes) {
    await page.goto("http://localhost:3000" + route);
    await page.locator("main").waitFor();
    await page.waitForTimeout(70);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "Overflow " + width + " " + route,
    );
    assert.equal(
      await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.some(
            (img) =>
              (img as HTMLImageElement).complete &&
              !(img as HTMLImageElement).naturalWidth,
          ),
        ),
      false,
      "Broken image " + route,
    );
    checks++;
  }
  await page.goto("http://localhost:3000/");
  await page.evaluate(() =>
    document
      .querySelectorAll('img[loading="lazy"]')
      .forEach((img) => img.setAttribute("loading", "eager")),
  );
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      null,
      { timeout: 10000 },
    )
    .catch(async (e) => {
      console.log(
        await page.locator("img").evaluateAll((a) =>
          a.map((i) => ({
            src: (i as HTMLImageElement).src,
            loaded: (i as HTMLImageElement).complete,
            width: (i as HTMLImageElement).naturalWidth,
          })),
        ),
      );
      throw e;
    });
  await page.waitForTimeout(900);
  await page.screenshot({
    path: "var/ui/home-en-" + width + ".png",
    fullPage: true,
  });
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Switch to Arabic" }).click(),
  ]);
  await page.waitForFunction(() => document.documentElement.lang === "ar");
  await page.evaluate(() =>
    document
      .querySelectorAll('img[loading="lazy"]')
      .forEach((img) => img.setAttribute("loading", "eager")),
  );
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      null,
      { timeout: 10000 },
    )
    .catch(async (e) => {
      console.log(
        await page.locator("img").evaluateAll((a) =>
          a.map((i) => ({
            src: (i as HTMLImageElement).src,
            loaded: (i as HTMLImageElement).complete,
            width: (i as HTMLImageElement).naturalWidth,
          })),
        ),
      );
      throw e;
    });
  await page.waitForTimeout(700);
  await page.screenshot({
    path: "var/ui/home-ar-" + width + ".png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Arabic home overflow " + width,
  );
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Switch to English" }).click(),
  ]);
  await page.waitForFunction(() => document.documentElement.lang === "en");
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto("http://localhost:3000/admin");
await page.getByLabel("Email", { exact: true }).fill("ui@example.invalid");
await page.getByLabel("Password", { exact: true }).fill(adminPassword);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL("**/admin/dashboard").catch(async (e) => {
  console.log(
    "LOGIN FAILURE",
    page.url(),
    await page.locator("[role=alert]").allTextContents(),
    errors,
  );
  await page.screenshot({ path: "var/ui/login-failure.png" });
  throw e;
});
await page.getByRole("heading", { name: "Overview" }).waitFor();
for (const route of [
  "products",
  "orders",
  "customers",
  "content",
  "settings",
  "coupons",
  "users",
  "audit",
]) {
  await page.goto("http://localhost:3000/admin/" + route);
  await page.locator(".admin-main").waitFor();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("[role=alert]").count(),
    0,
    "Admin error " + route,
  );
  checks++;
}
await page.goto("http://localhost:3000/admin/products/new");
await page.getByLabel("name en", { exact: true }).fill("SOLÉA Browser Test");
await page.getByLabel("name ar", { exact: true }).fill("منتج اختبار SOLÉA");
await page.getByLabel("sku", { exact: true }).fill("UI-TEST");
await page.getByLabel("slug", { exact: true }).fill("ui-test");
await page.getByRole("button", { name: "Save product" }).click();
await page.waitForURL("**/admin/products");
assert.equal(
  (await db.query("SELECT count(*)::int n FROM products WHERE sku='UI-TEST'"))
    .rows[0].n,
  1,
);
checks++;
await db.query(
  'UPDATE store_settings SET enabled=true,shipping_zones=\'[{"governorate":"QA region","zone":"","fee":500,"active":true}]\'',
);
await db.query(
  "UPDATE content SET published=true WHERE key IN ('privacy','terms','returns','shipping-policy')",
);
await db.query("UPDATE products SET price=10000 WHERE slug='baby-shampoo'");
await db.query(
  "UPDATE inventory SET stock=12 WHERE product_id=(SELECT id FROM products WHERE slug='baby-shampoo')",
);
await page.goto("http://localhost:3000/products/baby-shampoo");
await page.getByRole("button", { name: "Add to bag", exact: true }).click();
await page
  .getByRole("status")
  .filter({ hasText: "Added to your bag." })
  .waitFor();
await page.goto("http://localhost:3000/cart");
await page.getByRole("link", { name: "Continue to checkout" }).click();
await page.getByLabel("Full name", { exact: true }).fill("QA Customer");
await page.getByLabel("Mobile number", { exact: true }).fill("01000000000");
await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
await page.getByLabel("Governorate").selectOption("QA region");
await page.getByLabel("City", { exact: true }).fill("QA city");
await page.getByLabel("Street address").fill("QA Street");
await page.locator("input[name=acceptTerms]").check();
await page.getByRole("button", { name: "Place order", exact: true }).click();
await page.waitForURL("**/order-success?id=*");
await page.locator(".tracking-key").waitFor();
checks++;
await page.screenshot({
  path: "var/ui/order-confirmation.png",
  fullPage: true,
});
assert.deepEqual(errors, []);
console.log(
  JSON.stringify({
    browser: "Chromium",
    checks,
    viewports: [1440, 768, 390],
    consoleErrors: errors,
    scope:
      "Production React components and API handlers via intercepted HTTP; Next runtime networking is not exercised.",
  }),
);
await browser.close();
await engine.close();
