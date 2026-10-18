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
Object.assign(process.env, {
  PAYMOB_ENABLED: "true",
  PAYMOB_SECRET_KEY: "ui-test-server-secret",
  PAYMOB_PUBLIC_KEY: "ui-test-public-key",
  PAYMOB_HMAC_SECRET: randomBytes(32).toString("hex"),
  PAYMOB_INTEGRATION_IDS: "123456",
});
await import("./seed");
const { products } = await import("../src/server/catalog");
const { storeData } = await import("../src/server/store");
const { admin } = await import("../src/server/security");
const adminPassword = "BrowserA1" + randomBytes(10).toString("hex");
await db.query(
  "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner') RETURNING id",
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
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin: "http://localhost:3000",
});
const errors: string[] = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
async function revealPage() {
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  for (let y = 0; y < height; y += 700) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(35);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
}
const css = await readFile("src/app/globals.css", "utf8");
const app = await readFile("var/ui/app.js");
await context.route("https://qr.example.invalid/**", async (r) => {
  const label = r.request().url().includes("instapay")
    ? "InstaPay"
    : "Vodafone Cash";
  const modules = Array.from({ length: 15 }, (_, y) =>
    Array.from({ length: 15 }, (_, x) =>
      (x * 7 + y * 11 + x * y) % 5 < 2
        ? `<rect x="${x * 10}" y="${y * 10}" width="10" height="10"/>`
        : "",
    ).join(""),
  ).join("");
  await r.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="white"/><g transform="translate(15 15)" fill="#4F5B2D">${modules}</g><title>Test ${label} QR</title></svg>`,
  });
});
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
      if (
        !res.ok &&
        !(url.pathname === "/api/account/me" && res.status === 401)
      )
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
    if (url.pathname.startsWith("/ops-portal")) {
      try {
        user = (await admin(new NextRequest(url.href, { headers: h }))).user;
      } catch {
        await r.fulfill({ status: 302, headers: { location: "/ops-portal" } });
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
      "/about",
      "/cart",
      "/checkout",
      "/contact",
      "/faq",
      "/shipping-policy",
      "/returns",
      "/privacy",
      "/terms",
      "/distance-selling",
      "/track-order",
      "/account/login",
      "/account/register",
      "/account",
      "/account/orders",
      "/account/addresses",
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
  assert.equal(await page.locator(".social-grid > a").count(), 3);
  assert.equal(await page.locator('.social-grid img[src*="box"]').count(), 0);
  assert.equal(await page.locator('a[href="/admin"]').count(), 0);
  assert.equal(await page.locator('a[href="/ingredients"]').count(), 0);
  assert.equal(
    await page
      .getByText(
        /Ingredients|INCI|Key Ingredients|Our Ingredients|What.s Inside/i,
      )
      .count(),
    0,
  );
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
  await revealPage();
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
  await revealPage();
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
await page.goto("http://localhost:3000/ops-portal");
await page.getByLabel("Email", { exact: true }).fill("ui@example.invalid");
await page.getByLabel("Password", { exact: true }).fill(adminPassword);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL("**/ops-portal").catch(async (e) => {
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
await page.screenshot({ path: "var/ui/admin-dashboard.png", fullPage: true });
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
  await page.goto("http://localhost:3000/ops-portal/" + route);
  await page.locator(".admin-main").waitFor();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("[role=alert]").count(),
    0,
    "Admin error " + route,
  );
  checks++;
}
await page.goto("http://localhost:3000/ops-portal/products/new");
await page.getByLabel("name en", { exact: true }).fill("SOLÉA Browser Test");
await page.getByLabel("name ar", { exact: true }).fill("منتج اختبار SOLÉA");
await page.getByLabel("sku", { exact: true }).fill("UI-TEST");
await page.getByLabel("slug", { exact: true }).fill("ui-test");
await page.getByRole("button", { name: "Save product" }).click();
await page.waitForURL("**/ops-portal/products");
assert.equal(
  (await db.query("SELECT count(*)::int n FROM products WHERE sku='UI-TEST'"))
    .rows[0].n,
  1,
);
checks++;
await page.goto("http://localhost:3000/account/register");
await page.getByLabel("First name").fill("Browser");
await page.getByLabel("Last name").fill("Customer");
await page.getByLabel("Email").fill("browser-customer@example.invalid");
await page.getByLabel("Mobile").fill("01000000000");
await page.getByLabel("New password").fill("BrowserCustomer9!");
await page.getByLabel("Confirm password").fill("BrowserCustomer9!");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL("**/account");
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
assert.equal(await page.locator(".thumbnails > button").count(), 4);
assert.equal(
  await page
    .getByText(
      /Ingredients|INCI|Key Ingredients|Our Ingredients|What.s Inside/i,
    )
    .count(),
  0,
);
await revealPage();
await page.screenshot({ path: "var/ui/product-desktop.png", fullPage: true });
await page.locator(".thumbnails > button").nth(1).click();
assert.match(
  String(await page.locator(".gallery-main img").getAttribute("src")),
  /product-benefits-v2\.webp$/,
);
await page.screenshot({ path: "var/ui/product-benefits.png", fullPage: true });
await page.locator(".thumbnails > button").nth(3).click();
assert.match(
  String(await page.locator(".gallery-main img").getAttribute("src")),
  /product-how-to-v2\.webp$/,
);
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
await page.waitForURL("**/order-success?orderId=*");
await page.locator(".tracking-key").waitFor();
checks++;
await page.screenshot({
  path: "var/ui/order-confirmation.png",
  fullPage: true,
});

await page.goto("http://localhost:3000/account/register");
await page.getByLabel("Name", { exact: true }).fill("Browser Customer");
await page
  .getByLabel("Email", { exact: true })
  .fill("browser-customer@example.invalid");
await page.getByLabel("Mobile (optional)", { exact: true }).fill("01000000000");
await page
  .getByLabel("New password", { exact: true })
  .fill("BrowserCustomer9!");
await page
  .getByLabel("Confirm password", { exact: true })
  .fill("BrowserCustomer9!");
await page.getByRole("button", { name: "Create account", exact: true }).click();
await page.waitForURL("**/account");
await page
  .getByRole("heading", { name: "Welcome, Browser Customer." })
  .waitFor();
checks++;

await page.goto("http://localhost:3000/account/addresses");
await page.getByLabel("Label", { exact: true }).fill("Home");
await page.getByLabel("Full name", { exact: true }).fill("Browser Customer");
await page.getByLabel("Mobile", { exact: true }).fill("01000000000");
await page.getByLabel("Governorate", { exact: true }).fill("QA region");
await page.getByLabel("City", { exact: true }).fill("QA city");
await page.getByLabel("Street address", { exact: true }).fill("QA Street");
await page.getByRole("button", { name: "Add address", exact: true }).click();
await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
checks++;

await page.goto("http://localhost:3000/products/baby-shampoo");
await page.getByRole("button", { name: "Add to bag", exact: true }).click();
await page
  .getByRole("status")
  .filter({ hasText: "Added to your bag." })
  .waitFor();
await page.goto("http://localhost:3000/checkout");
await page.getByLabel("Saved address").waitFor();
assert.equal(
  await page.getByLabel("Pay Online Securely", { exact: true }).isEnabled(),
  true,
);
await page.getByLabel("InstaPay", { exact: true }).check();
await page.locator("input[name=acceptTerms]").check();
await page.getByRole("button", { name: "Place order", exact: true }).click();
await page.waitForURL("**/order-success?orderId=*");
await page.getByRole("img", { name: "InstaPay payment QR code" }).waitFor();
await page.getByRole("button", { name: "Copy account", exact: true }).click();
await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
await page
  .getByLabel("Transaction reference", { exact: true })
  .fill("BROWSER-REF-123");
await page
  .getByRole("button", { name: "Submit reference", exact: true })
  .click();
await page.getByText("Submitted for verification.", { exact: true }).waitFor();
checks += 2;

await page.setViewportSize({ width: 390, height: 844 });
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
  "Payment mobile overflow",
);
await page.screenshot({
  path: "var/ui/payment-instapay-mobile.png",
  fullPage: true,
});
await page.goto("http://localhost:3000/account");
await page
  .getByRole("heading", { name: "Welcome, Browser Customer." })
  .waitFor();
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
  "Account mobile overflow",
);
await page.screenshot({ path: "var/ui/account-mobile.png", fullPage: true });
await page.goto("http://localhost:3000/account/orders");
await page.getByRole("link", { name: "View details" }).first().click();
await page.waitForURL("**/account/orders/*");
await page.getByRole("heading", { name: "Order details" }).waitFor();
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
  "Order detail mobile overflow",
);
await page.screenshot({
  path: "var/ui/account-order-mobile.png",
  fullPage: true,
});
checks += 3;

await page.setViewportSize({ width: 768, height: 960 });
await page.goto("http://localhost:3000/products/baby-shampoo");
await page.getByRole("button", { name: "Add to bag", exact: true }).click();
await page
  .getByRole("status")
  .filter({ hasText: "Added to your bag." })
  .waitFor();
await page.goto("http://localhost:3000/checkout");
await page.getByLabel("Saved address").waitFor();
await page.getByLabel("Vodafone Cash", { exact: true }).check();
await page.locator("input[name=acceptTerms]").check();
await page.getByRole("button", { name: "Place order", exact: true }).click();
await page.waitForURL("**/order-success?orderId=*");
await page
  .getByRole("img", { name: "Vodafone Cash payment QR code" })
  .waitFor();
await page.getByRole("button", { name: "Copy number", exact: true }).click();
await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
  "Vodafone tablet overflow",
);
await page.screenshot({
  path: "var/ui/payment-vodafone-tablet.png",
  fullPage: true,
});
checks += 2;

await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto("http://localhost:3000/");
assert.equal(
  await page.evaluate(() => document.body.classList.contains("motion-ready")),
  false,
  "Reduced motion remains enabled",
);
assert.equal(
  await page
    .locator("main > section")
    .evaluateAll((nodes) =>
      nodes.every((node) => node.classList.contains("is-visible")),
    ),
  true,
);
await page.emulateMedia({ reducedMotion: "no-preference" });
checks++;
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
