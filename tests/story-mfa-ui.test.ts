import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium as playwright, type Browser, type Page } from "playwright";
import chromium from "@sparticuz/chromium";

let browser: Browser;
let temporary: string;
let app: Buffer;
const css = await readFile("src/app/globals.css", "utf8");
const approvedEnglish = [
  "Born from a mother’s love. Created with every child’s needs in mind.",
  "Soléa’s story began with motherhood.",
  "As a mother, I began to question the products I used for my baby and look for gentle, trustworthy, and thoughtfully crafted care products. What started as a personal search gradually became a dream: to create a brand that cares not only for our own children, but for the unique needs of every child.",
  "Because we know that every child is different. For children with special needs and their families, everyday care can carry an even deeper meaning—one that requires greater sensitivity, understanding, and trust.",
  "That is why we created Soléa with love and care, keeping children with different needs and their families in mind.",
  "Soléa Baby was created to bring together nature-inspired ingredients, thoughtful formulation, and a mother’s care, with the delicate needs of babies and children at the heart of everything we do.",
  "For us, care is about more than simply cleansing.\nIt means being gentle, building trust, and respecting every child’s unique world.",
  "Clean ingredients. Gentle care. A mother’s love.",
  "Because we know that\nevery mother wants the very best for her baby. And that is exactly the feeling with which we created Soléa.",
  "Soléa Baby\nEvery child is special. Every touch, with love.",
];
const approvedArabic = [
  "وُلدت من حب أم. وصُنعت لتراعي احتياجات كل طفل.",
  "بدأت حكاية Soléa مع الأمومة.",
  "كأم، بدأت أتساءل عن المنتجات التي أستخدمها لطفلي، وأبحث عن منتجات عناية لطيفة، جديرة بالثقة، ومصنوعة بعناية مدروسة. وما بدأ كبحث شخصي تحوّل تدريجيًا إلى حلم: أن نؤسس علامة تهتم ليس فقط بأطفالنا، بل بالاحتياجات الفريدة لكل طفل.",
  "لأننا نعرف أن كل طفل مختلف. وبالنسبة للأطفال ذوي الاحتياجات الخاصة وأسرهم، قد تحمل العناية اليومية معنى أعمق، يتطلب مزيدًا من مراعاة احتياجاتهم، والتفهّم، والثقة.",
  "لهذا أنشأنا Soléa بحب وعناية، واضعين في اعتبارنا الأطفال باختلاف احتياجاتهم وأسرهم.",
  "أُنشئت Soléa Baby لتجمع بين مكونات مستوحاة من الطبيعة، وتركيبة مدروسة، وعناية أم، مع وضع احتياجات الرضّع والأطفال الدقيقة في قلب كل ما نقوم به.",
  "بالنسبة لنا، العناية أكثر من مجرد تنظيف.\nإنها تعني اللطف، وبناء الثقة، واحترام عالم كل طفل الفريد.",
  "مكونات نقية. عناية لطيفة. حب أم.",
  "لأننا نعرف أن\nكل أم تريد الأفضل لطفلها. وهذا هو الشعور نفسه الذي أنشأنا به Soléa.",
  "Soléa Baby\nكل طفل مميّز. وكل لمسة، بحب.",
];
before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "solea-story-auth-"));
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
  app = await readFile(path.join(temporary, "app.js"));
});
after(async () => {
  await browser?.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
async function pageFixture() {
  browser = await playwright.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (await chromium.executablePath()),
    args: process.env.CHROMIUM_PATH ? [] : chromium.args.filter((arg) => arg !== "--disable-web-security"),
    headless: true,
  });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  const submissions: unknown[] = [];
  const apiPaths: string[] = [];
  let authenticated = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("http://localhost:3000/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      apiPaths.push(url.pathname);
      if (url.pathname === "/api/auth/login") {
        submissions.push(route.request().postDataJSON());
        authenticated = true;
      }
      await route.fulfill({
        status: url.pathname === "/api/account/me" ? 401 : 200,
        json:
          url.pathname === "/api/session"
            ? { csrf: "ui-only", customer: false, admin: false }
            : url.pathname === "/api/admin/reporting"
              ? { current: { period_id: null, starts_at: null }, periods: [], backups: [] }
            : url.pathname === "/api/admin/dashboard"
              ? { metrics: {}, orders: [], products: 0, jobs: 0 }
              : { ok: true, csrf: "ui-only" },
      });
      return;
    }
    if (url.pathname === "/test.js") {
      await route.fulfill({ contentType: "application/javascript", body: app });
      return;
    }
    if (url.pathname.startsWith("/media/")) {
      await route.fulfill({
        contentType: "image/png",
        body: await readFile(path.join("public", url.pathname)),
      });
      return;
    }
    const locale = (await route.request().allHeaders()).cookie?.includes(
      "lang=ar",
    )
      ? "ar"
      : "en";
    const fixture = {
      products: [],
      locale,
      user: authenticated
        ? { email: "ui@example.invalid", permissions: ["users"] }
        : null,
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
      body: `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(fixture)}</script><script src="/test.js"></script></body></html>`,
    });
  });
  return { context, page, errors, submissions, apiPaths };
}
async function storyParagraphs(page: Page) {
  return page
    .locator(".about-story p")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).innerText),
    );
}
test("Our Story renders exact English and full Arabic, switches language and fits desktop/tablet/mobile RTL", async () => {
  const { context, page, errors } = await pageFixture();
  try {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await context.clearCookies();
      await page.goto("http://localhost:3000/about");
      await page.locator(".about-story").waitFor();
      assert.equal(await page.locator("main h1").innerText(), "Our Story");
      assert.deepEqual(await storyParagraphs(page), approvedEnglish);
      assert.deepEqual(await page.locator('header a[href="/about"], footer a[href="/about"]').allTextContents(), ["Our Story", "Our Story"]);
      if (width === 390) {
        await page.getByRole("button", { name: "Navigation", exact: true }).click();
        assert.equal(await page.locator('header nav a[href="/about"]').isVisible(), true);
      }
      await page.getByRole("button", { name: "Switch to Arabic", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("main h1")?.textContent === "حكايتنا");
      assert.deepEqual(await storyParagraphs(page), approvedArabic);
      assert.equal(await page.locator(".about-story").getAttribute("dir"), "rtl");
      assert.equal(await page.locator(".about-story").evaluate((el) => getComputedStyle(el).direction), "rtl");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const blocks = await page.locator(".about-story p").evaluateAll((nodes) => nodes.map((el) => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.clientWidth, scroll: el.scrollWidth })));
      assert.ok(blocks.every((b) => b.left >= 0 && b.right <= width && b.scroll <= b.width));
      if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/story-ar-${width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Switch to English", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("main h1")?.textContent === "Our Story");
      assert.deepEqual(await storyParagraphs(page), approvedEnglish);
      if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/story-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
test("admin password login has no authenticator input, enrollment, QR or second step", async () => {
  const { context, page, errors, submissions, apiPaths } = await pageFixture();
  try {
    await page.goto("http://localhost:3000/ops-portal");
    await page.locator('input[name="email"]').fill("ui@example.invalid");
    await page.locator('input[name="password"]').fill("BrowserFixture9!");
    assert.equal(
      await page
        .locator('input[name="code"], input[autocomplete="one-time-code"]')
        .count(),
      0,
    );
    assert.equal(
      await page.getByAltText("Authenticator setup QR code").count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator(".admin-login").innerText(),
      /authenticator|two-factor|recovery|backup/i,
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator(".admin-main").waitFor();
    assert.equal(new URL(page.url()).pathname, "/ops-portal");
    assert.deepEqual(submissions, [
      { email: "ui@example.invalid", password: "BrowserFixture9!" },
    ]);
    assert.ok(apiPaths.every((p) => !p.includes("mfa")));
    await page.goto("http://localhost:3000/ops-portal/security");
    await page
      .getByText(
        "Use a strong, unique password. Sign out when you finish using this device.",
        { exact: true },
      )
      .waitFor();
    assert.doesNotMatch(
      await page.locator(".admin-main").innerText(),
      /authenticator|two-factor|recovery|backup/i,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});
