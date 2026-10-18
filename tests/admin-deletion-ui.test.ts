import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";

test("admin deletion dialog hides self/unauthorized actions, contains only safe data, handles errors and prevents duplicate submission", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "solea-delete-ui-"));
  const localBrowser = process.env.CHROMIUM_PATH;

const browser = await playwright.launch({
  executablePath: localBrowser || (await chromium.executablePath()),
  args: localBrowser
    ? []
    : chromium.args.filter((a) => a !== "--disable-web-security"),
  headless: true,
});
  try {
    await build({
      entryPoints: ["tests/browser/entry.tsx"],
      bundle: true,
      platform: "browser",
      format: "iife",
      outfile: path.join(temporary, "app.js"),
      jsx: "automatic",
      alias: {
        "next/link": path.resolve("tests/browser/link.tsx"),
        "next/navigation": path.resolve("tests/browser/navigation.ts"),
      },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const app = await readFile(path.join(temporary, "app.js"));
    const css = await readFile("src/app/globals.css", "utf8");
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let permissions = ["users"],
      deleted = false,
      fail = true;
    const submissions: unknown[] = [];
    let release: (() => void) | undefined;
    await context.route("http://localhost:3000/**", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname === "/api/admin/users/target" &&
        route.request().method() === "DELETE"
      ) {
        submissions.push(route.request().postDataJSON());
        if (fail) {
          await route.fulfill({
            status: 404,
            json: { error: "ADMIN_DELETE_UNAVAILABLE" },
          });
          return;
        }
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        deleted = true;
        await route.fulfill({ json: { ok: true } });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({
          status: url.pathname === "/api/account/me" ? 401 : 200,
          json:
            url.pathname === "/api/admin/users"
              ? [
                  {
                    id: "self",
                    email: "actor@example.invalid",
                    role_id: "owner",
                    active: true,
                  },
                  ...(deleted
                    ? []
                    : [
                        {
                          id: "target",
                          email: "target@example.invalid",
                          role_id: "manager",
                          active: true,
                        },
                      ]),
                ]
              : { csrf: "ui-only" },
        });
        return;
      }
      if (url.pathname === "/test.js") {
        await route.fulfill({
          contentType: "application/javascript",
          body: app,
        });
        return;
      }
      if (url.pathname.startsWith("/media/")) {
        await route.fulfill({
          contentType: "image/png",
          body: await readFile(path.join("public", url.pathname)),
        });
        return;
      }
      const fixture = {
        locale: "en",
        products: [],
        user: { email: "actor@example.invalid", permissions },
        data: {
          categories: [],
          content: [],
          settings: {
            phone: "01000000000",
            instagram: "test",
            paymob: { enabled: false },
          },
        },
      };
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script src="/test.js"></script></body></html>`,
      });
    });
    await page.goto("http://localhost:3000/ops-portal/users");
    await page
      .getByRole("button", { name: "Delete Admin", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Delete Admin", exact: true })
        .count(),
      1,
    );
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("button", { name: "Delete Admin", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /target@example.invalid/);
      assert.doesNotMatch(
        await dialog.innerText(),
        /recovery|password hash|secret|SMS|authenticator|TOTP/i,
      );
      const rect = await dialog.boundingBox();
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width);
      assert.equal(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Cancel", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      if (process.env.UI_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.UI_SCREENSHOT_DIR}/admin-delete-${width}.png`,
          fullPage: true,
        });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
    await page
      .getByRole("button", { name: "Delete Admin", exact: true })
      .click();
    assert.equal(await page.locator("dialog input").count(), 0);
    await page
      .getByRole("button", { name: "Delete Administrator", exact: true })
      .click();
    await page
      .getByText("Unable to delete this administrator.", { exact: true })
      .waitFor();
    fail = false;
    await page
      .getByRole("button", { name: "Delete Administrator", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLButtonElement>(
          "dialog button.admin-destructive",
        )?.disabled,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Deleting…", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    await expect.poll(() => submissions).toEqual([{}, {}]);
    release?.();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent === "Delete Admin",
        ),
    );
    permissions = [];
    deleted = false;
    await page.reload();
    await page.getByRole("heading", { name: "Add administrator" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Delete Admin", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
