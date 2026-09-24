import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { Pool } from "pg";
import { chromium as playwright } from "playwright";
import chromium from "@sparticuz/chromium";
import assert from "node:assert/strict";

await mkdir("var/runtime", { recursive: true });
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "var/runtime/key.pem",
    "-out",
    "var/runtime/cert.pem",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ],
  { stdio: "ignore" },
);
const engine = await PGlite.create();
const database = new PGLiteSocketServer({
  db: engine,
  host: "127.0.0.1",
  port: 55440,
  maxConnections: 20,
});
await database.start();
const url = "https://localhost:3443";
const env = {
  ...process.env,
  NODE_ENV: "production" as const,
  APP_URL: url,
  DATABASE_URL: "postgresql://postgres@127.0.0.1:55440/postgres",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  TRUST_PROXY: "true",
  MEDIA_DIR: "./var/runtime/media",
  NEXT_TELEMETRY_DISABLED: "1",
};
const run = async (file: string) => {
  const child = spawn(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: "pipe",
  });
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(output)),
    );
    child.on("error", reject);
  });
};
await run("scripts/migrate.ts");
await run("scripts/seed.ts");
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
const password = "RuntimeA1" + randomBytes(12).toString("hex");
const bcrypt = (await import("bcryptjs")).default;
await pool.query(
  "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner')",
  ["runtime@example.invalid", await bcrypt.hash(password, 4)],
);
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", "3002", "-H", "127.0.0.1"],
  { env, stdio: "pipe" },
);
let serverLog = "";
server.stdout.on("data", (b) => (serverLog += b));
server.stderr.on("data", (b) => (serverLog += b));
const proxy = createServer(
  {
    key: await readFile("var/runtime/key.pem"),
    cert: await readFile("var/runtime/cert.pem"),
  },
  (req, res) => {
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 3002,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          "x-real-ip": "127.0.0.1",
          "x-forwarded-proto": "https",
        },
      },
      (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
await new Promise<void>((resolve) => proxy.listen(3443, "127.0.0.1", resolve));
const browser = await playwright.launch({
  executablePath:
    process.env.CHROMIUM_PATH || (await chromium.executablePath()),
  args: chromium.args.filter((x) => x !== "--disable-web-security"),
  headless: true,
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3002/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  let checks = 0;
  for (const route of [
    "/",
    "/products",
    "/products/baby-shampoo",
    "/about",
    "/cart",
    "/checkout",
    "/order-success",
    "/track-order",
    "/contact",
    "/faq",
    "/shipping-policy",
    "/returns",
    "/privacy",
    "/terms",
    "/distance-selling",
    "/admin",
  ]) {
    const response = await page.goto(url + route);
    assert.equal(response?.status(), 200, route);
    assert.ok(response?.headers()["content-security-policy"]);
    assert.ok(response?.headers()["strict-transport-security"]);
    await page.locator("main").waitFor();
    checks++;
  }
  assert.equal(
    (await context.request.get(url + "/missing-route")).status(),
    404,
  );
  assert.equal((await context.request.get(url + "/ingredients")).status(), 404);
  const sitemap = await (
    await context.request.get(url + "/sitemap.xml")
  ).text();
  assert.equal(sitemap.includes("/ingredients"), false);
  assert.equal(
    (await context.request.get(url + "/api/admin/products")).status(),
    401,
  );
  const publicProducts = await (
    await context.request.get(url + "/api/products")
  ).json();
  assert.equal(Object.hasOwn(publicProducts[0], "inci"), false);
  await page.goto(url + "/");
  assert.equal(await page.locator('a[href="/admin"]').count(), 0);
  assert.equal(await page.locator(".social-grid > a").count(), 3);
  await page.goto(url + "/admin/dashboard");
  await page.waitForURL("**/admin");
  checks += 5;
  await page
    .getByLabel("Email", { exact: true })
    .fill("runtime@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/dashboard");
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  checks++;
  const cookie = (await context.cookies()).find(
    (c) => c.name === "__Host-sol-session",
  );
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === "Lax");
  await page.goto(url + "/admin/products/new");
  await page.getByLabel("name en", { exact: true }).fill("SOLÉA Runtime Test");
  await page.getByLabel("name ar", { exact: true }).fill("منتج اختبار SOLÉA");
  await page.getByLabel("sku", { exact: true }).fill("RUNTIME-TEST");
  await page.getByLabel("slug", { exact: true }).fill("runtime-test");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL("**/admin/products");
  checks++;
  await pool.query(
    'UPDATE store_settings SET enabled=true,shipping_zones=\'[{"governorate":"QA region","zone":"","fee":500,"active":true}]\'',
  );
  await pool.query(
    "UPDATE content SET published=true WHERE key IN ('terms','privacy','returns','shipping-policy')",
  );
  await pool.query("UPDATE products SET price=10000 WHERE slug='baby-shampoo'");
  await pool.query(
    "UPDATE inventory SET stock=12 WHERE product_id=(SELECT id FROM products WHERE slug='baby-shampoo')",
  );
  await page.goto(url + "/products/baby-shampoo");
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Added to your bag." })
    .waitFor();
  await page.goto(url + "/cart");
  await page.getByRole("link", { name: "Continue to checkout" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Runtime Test");
  await page.getByLabel("Mobile number", { exact: true }).fill("01000000000");
  await page.getByLabel("Email", { exact: true }).fill("test@example.invalid");
  await page.getByLabel("Governorate").selectOption("QA region");
  await page.getByLabel("City", { exact: true }).fill("QA city");
  await page.getByLabel("Street address").fill("QA Street");
  await page.locator("input[name=acceptTerms]").check();
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.waitForURL("**/order-success?id=*");
  await page.locator(".tracking-key").waitFor();
  checks++;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + "/");
  await page.getByRole("button", { name: "Switch to Arabic" }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ar");
  await page
    .getByRole("heading", { name: "عناية لطيفة لأجمل البدايات." })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "var/runtime/mobile-ar.png", fullPage: true });
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks,
      mode: "Next production build, HTTPS, TCP PGlite, real browser, actual session cookies",
      consoleErrors: errors,
    }),
  );
} finally {
  await writeFile("var/runtime/server.log", serverLog);
  await browser.close();
  proxy.closeAllConnections();
  await new Promise<void>((r) => proxy.close(() => r()));
  server.kill("SIGTERM");
  await pool.end();
  await database.stop();
  await engine.close();
}
