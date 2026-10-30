import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { chromium as playwright, type Browser } from "playwright";
import chromium from "@sparticuz/chromium";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
let browser: Browser, temp: string, app: Buffer;
const css = await readFile("src/app/globals.css", "utf8");
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "solea-recovery-ui-"));
  await build({
    entryPoints: ["tests/browser/entry.tsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(temp, "app.js"),
    jsx: "automatic",
    alias: {
      "next/link": path.resolve("tests/browser/link.tsx"),
      "next/image": path.resolve("tests/browser/image.tsx"),
      "next/navigation": path.resolve("tests/browser/navigation.ts"),
    },
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  app = await readFile(path.join(temp, "app.js"));
});
after(async () => {
  await browser?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});
for (const locale of ["en", "ar"] as const)
  for (const audience of ["customer", "admin"] as const) {
    test(`${audience} recovery UI ${locale}: request, secure fragment, confirmation, password visibility, invalid link and responsive layout`, async () => {
      browser = await playwright.launch({
        executablePath:
          process.env.CHROMIUM_PATH || (await chromium.executablePath()),
        args: process.env.CHROMIUM_PATH ? [] : chromium.args.filter((x) => x !== "--disable-web-security"),
        headless: true,
      });
      const context = await browser.newContext({
        viewport:
          locale === "ar"
            ? { width: 390, height: 844 }
            : { width: 1366, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors: string[] = [],
        requests: { path: string; body: Record<string, string> }[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let unavailable = false;
      await context.route("http://localhost:3000/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/test.js")
          return route.fulfill({
            contentType: "application/javascript",
            body: app,
          });
        if (url.pathname.startsWith("/api/")) {
          if (
            url.pathname.endsWith("/reset-request") ||
            url.pathname.endsWith("/reset")
          ) {
            requests.push({
              path: url.pathname,
              body: route.request().postDataJSON(),
            });
            return route.fulfill({
              status: unavailable ? 503 : 200,
              json: unavailable ? { error: "EMAIL_UNAVAILABLE" } : { ok: true },
            });
          }
          return route.fulfill({
            status: url.pathname === "/api/account/me" ? 401 : 200,
            json: { csrf: "ui-only", items: [], subtotal: 0 },
          });
        }
        if (url.pathname.startsWith("/media/"))
          return route.fulfill({
            contentType: "image/png",
            body: await readFile(path.join("public", url.pathname)),
          });
        const fixture = {
          products: [],
          locale,
          user: null,
          data: {
            categories: [],
            content: [],
            settings: {
              phone: "01039010190",
              instagram: "soleababy.egypt",
              paymob: { enabled: false },
            },
          },
        };
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script src="/test.js"></script></body></html>`,
        });
      });
      try {
        await page.goto(
          "http://localhost:3000" +
            (audience === "customer" ? "/account/forgot" : "/ops-portal"),
        );
        if (audience === "admin")
          await page
            .getByRole("button", {
              name: locale === "en" ? "Forgot password?" : "نسيت كلمة المرور؟",
              exact: true,
            })
            .click();
        await page
          .locator('input[name="email"]')
          .fill("registered@example.invalid");
        unavailable = true;
        await page
          .locator("form button[type=submit], form button.button")
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        unavailable = false;
        await page
          .locator("form button[type=submit], form button.button")
          .click();
        await expect(page.getByRole("status")).toContainText(
          locale === "en" ? "If an account exists" : "إذا كان هناك حساب",
        );
        assert.equal(requests.at(-1)?.body.locale, locale);
        await expect(page.locator("form button.button")).toBeDisabled();
        const raw = randomBytes(32).toString("hex");
        const resetPath =
          audience === "customer" ? "/account/reset" : "/ops-portal?reset=1";
        await page.goto("http://localhost:3000" + resetPath + "#token=" + raw);
        await expect(
          page.locator('input[name="confirmPassword"]'),
        ).toBeVisible();
        await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
        const show = page.getByRole("button", {
          name: locale === "en" ? "Show password" : "إظهار كلمة المرور",
          exact: true,
        });
        await show.click();
        await expect(page.locator('input[name="password"]')).toHaveAttribute(
          "type",
          "text",
        );
        const next = "Password9" + randomBytes(8).toString("hex");
        await page.locator('input[name="password"]').fill(next);
        await page.locator('input[name="confirmPassword"]').fill(next + "x");
        await page.locator("form button.button").click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.locator('input[name="confirmPassword"]').fill(next);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false);
        assert.equal(
          await page.evaluate(() => document.documentElement.dir),
          locale === "ar" ? "rtl" : "ltr",
        );
        await page
          .getByRole("button", {
            name: locale === "en" ? "Hide password" : "إخفاء كلمة المرور",
            exact: true,
          })
          .click();
        if (process.env.RECOVERY_SCREENSHOT_DIR) {
          await mkdir(process.env.RECOVERY_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({
            path: path.join(
              process.env.RECOVERY_SCREENSHOT_DIR,
              `${audience}-${locale}.png`,
            ),
            fullPage: true,
          });
        }
        await page.locator("form button.button").click();
        await page.waitForURL(/passwordReset=1/);
        assert.ok(requests.at(-1)?.body.token === raw);
        await expect(page.getByRole("status")).toContainText(
          locale === "en"
            ? "Password"
            : "تم تغيير|تم تحديث".split("|")[audience === "customer" ? 1 : 0],
        );
        assert.equal(
          await page
            .evaluate(
              () =>
                JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
            )
            .then((s) => s.includes(raw)),
          false,
        );
        await page.goto("http://localhost:3000" + resetPath + "#token=invalid");
        await expect(page.locator("form button.button")).toBeDisabled();
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
