import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";

for (const method of ["instapay", "vodafone_cash"])
  test(`${method} UI: copy fallback, mandatory screenshot, transfer details, WhatsApp, responsive bilingual pending state`, async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "solea-manual-ui-"));
    const browser = await playwright.launch({
      executablePath:
        process.env.CHROMIUM_PATH || (await chromium.executablePath()),
      args: process.env.CHROMIUM_PATH ? [] : chromium.args.filter((a) => a !== "--disable-web-security"),
      headless: true,
    });
    try {
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
      const app = await readFile(path.join(temp, "app.js"));
      const css = await readFile("src/app/globals.css", "utf8");
      const context = await browser.newContext({ reducedMotion: "reduce" }),
        page = await context.newPage();
      const errors: string[] = [],
        submissions: Record<string, unknown>[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let order = {
        id: "c5941900-e7c9-4c14-af70-e11c227dddc3",
        reference: "SOL-UI-TEST",
        status: "pending",
        payment_status: "awaiting_confirmation",
        payment_method: method,
        total: 11500,
        transfer_reference: null as string | null,
        proof_uploaded: false,
        submitted_at: null as string | null,
        items: [],
        trackingToken: "",
      };
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { value: undefined });
        document.execCommand = (command: string) => {
          if (command !== "copy") return false;
          document.documentElement.dataset.copied = (
            document.activeElement as HTMLTextAreaElement
          ).value;
          return true;
        };
      });
      await context.route("http://localhost:3000/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/test.js")
          return route.fulfill({
            contentType: "application/javascript",
            body: app,
          });
        if (url.pathname.startsWith("/api/")) {
          let json: unknown = { ok: true };
          if (url.pathname === "/api/session") json = { csrf: "ui-only" };
          if (url.pathname === "/api/order") json = order;
          if (url.pathname === "/api/payment-proof") {
            assert.match(
              route.request().headers()["content-type"],
              /multipart/,
            );
            order = { ...order, proof_uploaded: true };
          }
          if (url.pathname === "/api/payment-submission") {
            submissions.push(route.request().postDataJSON());
            order = { ...order, submitted_at: "2026-10-26T12:00:00Z" };
          }
          if (url.pathname === "/api/payment-whatsapp")
            json = {
              url:
                "https://wa.me/201039010190?text=" +
                encodeURIComponent(
                  "Hello SOLÉA, Order Number: SOL-UI-TEST. I will attach my payment screenshot to this WhatsApp conversation.",
                ),
            };
          return route.fulfill({ json });
        }
        if (url.pathname.startsWith("/media/"))
          return route.fulfill({
            contentType: "image/png",
            body: await readFile(path.join("public", url.pathname)),
          });
        const ar = (await route.request().allHeaders()).cookie?.includes(
          "lang=ar",
        );
        const fixture = {
          products: [],
          locale: ar ? "ar" : "en",
          user: null,
          data: {
            content: [],
            categories: [],
            settings: {
              phone: "01039010190",
              instagram: "soleababy.egypt",
              instapay: { enabled: true, account: "01039010190", qrUrl: "" },
              vodafoneCash: { enabled: true, number: "01039010190", qrUrl: "" },
              paymob: { enabled: false },
            },
          },
        };
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script src="/test.js"></script></body></html>`,
        });
      });
      await page.goto(
        "http://localhost:3000/order-success?orderId=" + order.id,
      );
      await expect(
        page.getByRole("heading", { name: "Your provisional order" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Copy Number", exact: true })
        .click();
      await expect(
        page.getByText("Phone number copied successfully.", { exact: true }),
      ).toBeVisible();
      assert.equal(
        await page.locator("html").getAttribute("data-copied"),
        "01039010190",
      );
      await expect(
        page.getByRole("button", {
          name: "Submit payment details",
          exact: true,
        }),
      ).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles({
        name: "payment.png",
        mimeType: "image/png",
        buffer: Buffer.from("browser transport fixture"),
      });
      await page
        .getByRole("button", { name: "Upload screenshot", exact: true })
        .click();
      await expect(
        page.getByText("Screenshot uploaded.", { exact: true }),
      ).toBeVisible();
      await page.locator("input[name=senderPhone]").fill("01000000000");
      await page.locator("input[name=amount]").fill("115.00");
      await page.locator("input[name=reference]").fill("UI-TRANSFER");
      await page
        .getByRole("button", { name: "Submit payment details", exact: true })
        .click();
      await expect(
        page.getByRole("link", {
          name: "Send Payment Confirmation via WhatsApp",
        }),
      ).toHaveAttribute("href", /^https:\/\/wa.me\/201039010190\?text=/);
      assert.deepEqual(submissions, [
        {
          orderId: order.id,
          senderPhone: "01000000000",
          transferredAmount: 11500,
          reference: "UI-TRANSFER",
        },
      ]);
      assert.equal(order.payment_status, "awaiting_confirmation");
      assert.equal(order.status, "pending");
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (process.env.UI_SCREENSHOT_DIR)
          await page.screenshot({
            path: `${process.env.UI_SCREENSHOT_DIR}/${method}-${width}.png`,
            fullPage: true,
          });
      }
      await page
        .getByRole("button", { name: "Switch to Arabic", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "طلبك المبدئي" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "نسخ الرقم", exact: true }),
      ).toBeVisible();
      assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        JSON.stringify(
          await page.locator(".admin-main *").evaluateAll((nodes) =>
            nodes
              .filter((el) => el.getBoundingClientRect().right > innerWidth)
              .slice(0, 12)
              .map((el) => ({
                tag: el.tagName,
                class: el.className,
                text: el.textContent?.slice(0, 80),
                width: el.clientWidth,
              })),
          ),
        ),
      );
      if (process.env.UI_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.UI_SCREENSHOT_DIR}/${method}-ar-390.png`,
          fullPage: true,
        });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await rm(temp, { recursive: true, force: true });
    }
  });

test("admin UI exposes reporting reset and evidence review with explicit approval attestations", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "solea-review-ui-"));
  const browser = await playwright.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (await chromium.executablePath()),
    args: process.env.CHROMIUM_PATH ? [] : chromium.args.filter((a) => a !== "--disable-web-security"),
    headless: true,
  });
  try {
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
    const app = await readFile(path.join(temp, "app.js")),
      css = await readFile("src/app/globals.css", "utf8");
    const context = await browser.newContext({ reducedMotion: "reduce" }),
      page = await context.newPage();
    const calls: { path: string; body: unknown }[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const order = {
      id: "ui-order",
      reference: "SOL-REVIEW",
      payment_method: "vodafone_cash",
      payment_status: "awaiting_confirmation",
      status: "pending",
      total: 11500,
      transferred_amount: 11500,
      sender_phone: "01000000000",
      mobile: "01000000000",
      name: "Fixture Customer",
      submission_version: 2,
      submitted_at: "2026-10-26T12:00:00Z",
      proof_storage_path: "private-fixture.webp",
      items: [],
    };
    await context.route("http://localhost:3000/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/test.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: app,
        });
      if (u.pathname.startsWith("/api/")) {
        if (route.request().method() === "POST")
          calls.push({
            path: u.pathname,
            body: route.request().postDataJSON(),
          });
        let json: unknown = { csrf: "ui-only" };
        if (u.pathname === "/api/admin/dashboard")
          json = {
            reporting: { starts_at: null },
            metrics: { total_orders: 0, revenue: 0 },
            orders: [],
            products: 1,
            jobs: 0,
          };
        if (u.pathname === "/api/admin/reporting")
          json = {
            current: { period_id: null, starts_at: null },
            periods: [],
            backups: [
              {
                id: "backup-fixture",
                label: "Verified fixture",
                created_at: "2026-10-26T12:00:00Z",
              },
            ],
          };
        if (u.pathname === "/api/admin/orders/ui-order") json = order;
        return route.fulfill({ json });
      }
      if (u.pathname.startsWith("/media/"))
        return route.fulfill({
          contentType: "image/png",
          body: await readFile(path.join("public", u.pathname)),
        });
      const fixture = {
        products: [],
        locale: "en",
        user: {
          email: "owner@example.invalid",
          permissions: ["users", "orders", "payments"],
        },
        data: {
          content: [],
          categories: [],
          settings: {
            phone: "01039010190",
            instagram: "test",
            paymob: { enabled: false },
          },
        },
      };
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script src="/test.js"></script></body></html>`,
      });
    });
    await page.goto("http://localhost:3000/ops-portal");
    await page.getByText("Reporting period", { exact: true }).click();
    await page.locator("select[name=backupId]").selectOption("backup-fixture");
    await page.locator("input[name=confirmation]").fill("RESET");
    await page
      .getByRole("button", { name: "Start new reporting period", exact: true })
      .click();
    await expect.poll(() => calls.length).toBe(1);
    assert.deepEqual(calls[0], {
      path: "/api/admin/reporting",
      body: {
        action: "reset",
        backupId: "backup-fixture",
        expectedPeriodId: null,
        confirmation: "RESET",
      },
    });
    await page.goto("http://localhost:3000/ops-portal/orders/ui-order");
    await expect(page.getByText(/Matches order total/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View payment proof" }),
    ).toHaveAttribute("href", "/api/admin/orders/ui-order/payment-proof");
    await expect(
      page.getByRole("link", { name: "Open customer WhatsApp" }),
    ).toHaveAttribute("href", "https://wa.me/201000000000");
    page.once("dialog", async (dialog) => {
      assert.match(dialog.message(), /WhatsApp.*funds/);
      await dialog.accept();
    });
    await page
      .getByRole("button", { name: "Confirm payment", exact: true })
      .click();
    await expect.poll(() => calls.length).toBe(2);
    assert.deepEqual(calls[1], {
      path: "/api/admin/orders/ui-order/confirm-payment",
      body: {
        submissionVersion: 2,
        whatsappVerified: true,
        receivedAmountVerified: true,
      },
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        JSON.stringify(
          await page.locator(".admin-main *").evaluateAll((nodes) =>
            nodes
              .filter((el) => el.getBoundingClientRect().right > innerWidth)
              .slice(0, 12)
              .map((el) => ({
                tag: el.tagName,
                class: el.className,
                text: el.textContent?.slice(0, 80),
                width: el.clientWidth,
              })),
          ),
        ),
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
