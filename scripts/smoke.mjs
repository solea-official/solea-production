import assert from "node:assert/strict";
const base = process.env.APP_URL;
assert.ok(base, "Set APP_URL to the running deployment");
let checks = 0;
for (const route of [
  "/",
  "/products",
  "/products/baby-shampoo",
  "/ingredients",
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
  "/admin",
  "/api/health",
  "/robots.txt",
  "/sitemap.xml",
]) {
  const response = await fetch(new URL(route, base), {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, route);
  for (const header of [
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "x-frame-options",
  ])
    assert.ok(response.headers.get(header), `${route}: ${header}`);
  checks++;
}
assert.equal((await fetch(new URL("/missing-page", base))).status, 404);
assert.equal((await fetch(new URL("/api/admin/products", base))).status, 401);
const admin = await fetch(new URL("/admin/dashboard", base), {
  redirect: "manual",
});
assert.ok([302, 303, 307, 308].includes(admin.status));
console.log(
  JSON.stringify({
    checks: checks + 3,
    scope: "HTTP route/header/auth smoke; does not submit orders",
  }),
);
