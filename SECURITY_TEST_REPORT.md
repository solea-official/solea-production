# SOLÉA — security and delivery verification

## Result and scope

The existing implementation was continued incrementally. The delivered source contains the bilingual Next.js storefront, server API, PostgreSQL schema/migrations, secure role-based admin, product/image/content/settings management, persistent cart, server-priced checkout, COD orders, tracking, audit records and background integration jobs. Prices, stock and shipping are not invented; launch gates remain closed until configured.

This is a record of performed checks, not a security certification or a claim that the application is ready for unrestricted live trading.

| Verification already completed | Result |
|---|---|
| `npm test` — unit, database/API, authorization, commerce and adapter tests | 37 tests passed; 0 failed/skipped |
| `npm run test:e2e` — real production React components and API handlers through intercepted browser requests | 52 checks passed; Chromium, desktop 1440px, tablet 768px, mobile 390px; no recorded page errors |
| `npm run test:runtime` — actual production Next server over local HTTPS, real cookies, PostgreSQL wire connection to PGlite | 23 checks passed; routes, headers, 404, protected admin, login, product creation, cart, COD order and Arabic switching; no recorded page errors |
| `npm run typecheck` and `npm run lint` | Passed |
| `npm run build` | Passed after the final application changes; production build artifact present |
| Repository secret-pattern scan | No findings in scanned source/configuration; environment values are placeholders or generated during setup/tests |
| `npm audit --json` — final confirmation | 0 reported vulnerabilities across 490 audited dependencies |

The final handoff did not repeat these full passing suites. Only packaging, documentation/environment completeness and dependency-audit confirmation were finalized. Browser/runtime tests preceded the final bcrypt byte-length restriction; that final change was covered by a dedicated regression test, the passing 37-test run, type/lint checks and a successful production rebuild.

## Components and attack cases exercised

- Authentication: invalid login, account rate limit, opaque hashed sessions, rotation on login, invalidation on logout/reset, one-use hashed reset token, production HttpOnly/Secure/SameSite cookies, byte limit preventing bcrypt truncation.
- Authorization: direct anonymous/customer admin requests, support-role product/settings/audit/user restrictions, product create/edit/archive/reactivation, malformed and nonexistent IDs. SQL grants were actually exercised: schema creation, role edits, audit mutation and product/order deletion were denied to the runtime role; permitted reads/audit inserts succeeded.
- Cart/checkout: browser price/total/status injection rejected, zero/negative/fractional/oversized quantities rejected where applicable, unknown/archived/unpriced products rejected, persistent quantity changes and additive cart behavior, stock checks, integer money/discount rounding, coupon limits, COD order snapshots, idempotent duplicate submission and conflict detection, stock restored once on cancellation.
- Orders: another session cannot retrieve an order or start its payment. Tracking requires a high-entropy private key and does not return customer address, email, phone or totals. State changes are authorized, validated and audited. COD collection is owner-only and requires a delivered COD order.
- Payments: server amount passed to the adapter; no card/CVV fields; hosted redirect origin/HTTPS allowlist; missing integration/provider errors fail closed. Forged/stale signatures, provider/amount mismatches and conflicting/replayed events rejected or safely deduplicated. Late captured payment after cancellation enqueues one refund without re-reserving stock; a refund acknowledgement alone does not mark payment refunded.
- Shipping/jobs: signed normalized shipping events, provider binding and forward-only delivery state; unauthenticated retry denied and failed-job retry resets attempts once. Live Bosta traffic and a complete production worker/provider lifecycle were not exercised.
- Input/files: representative SQL injection slug, stored script text handled as escaped React text, unexpected object fields, malformed JSON, invalid UTF-8, bounded oversized request streams, invalid MIME, executable data disguised as PNG, SVG and oversized upload rejection; valid image re-encoding and image ownership during reorder.
- Browser/UI: public routes, admin sections, product creation, gallery/assets, cart and COD flow, mobile/tablet overflow checks; English and Arabic screenshots visually inspected. No real customer information or product price was used by test fixtures.
- Headers: CSP with per-request nonce, anti-framing, nosniff, referrer/permissions policies; HSTS and secure cookies verified in production mode and on the local HTTPS server.

## Findings, remediation and retests

| Finding | Severity | Remediation | Retest |
|---|---|---|---|
| Payment arriving after an expired/cancelled card reservation had no refund path | High, commerce integrity | Record capture, leave order cancelled, queue one idempotent full refund; do not re-reserve stock | Passed |
| bcrypt character limit did not enforce its UTF-8 byte limit | Medium | Reject password input above 72 UTF-8 bytes at creation/reset/login; bootstrap password prompt hidden | Regression passed; build passed |
| Cart add replaced the current quantity | Medium, functional | Add through a serialized transaction; retain PUT for setting/removing quantity | Passed |
| No operator action to record collected COD | Medium, operational | Owner-only delivered-COD collection, audited and single transition | Passed |
| Unknown admin resource returned generic 500; malformed UTF-8 was not rejected explicitly | Low | Typed 404 error and fatal UTF-8 decoding with bounded input | Passed |
| Streamed missing-page response returned 200; rewrite failed behind local HTTPS proxy | Low | Explicit branded 404 response with security headers; validate missing product slugs | Production HTTPS and proxy checks passed |
| robots sitemap URL could be captured at build time | Low | Dynamic robots generation using runtime APP_URL | Build/runtime route review passed |
| Failed integration jobs required an operational retry path | Medium, operational | Owner-only retry endpoint/UI with audit trail | Passed |
| Test browser disabled web security and omitted Origin; test HTML missed UTF-8 charset | Test harness only | Restore Chromium web security and set UTF-8; production CSRF validation left strict | Browser login/checkout and RTL retested successfully |
| Build cache/test bundle polluted lint scope; runtime TypeScript config risked dev-only tooling | Tooling | Ignore generated artifacts, use runtime JS Next config, retain tsx as production script dependency | Lint/typecheck/build passed |

## Remaining production limitations and blockers

1. **Payment/Bosta/email are generic authenticated HTTPS bridge contracts, not completed native provider integrations. Credentials alone are insufficient.** Implement/approve the selected provider mappings, verify native webhook signatures at that boundary, and run sandbox creation, payment/refund, delivery and email UAT. Application HMAC tests do not verify any provider's native signature format.
2. No production credentials were supplied and no live card transaction, refund, shipment or email was sent. Remote idempotency and final settlement must be verified with the chosen services.
3. Database tests used PGlite, including its TCP multiplexer. Native PostgreSQL multi-connection locking/deadlocks, load/failover, container startup, Caddy certificate issuance, Cloudflare client-IP trust and backup restoration require staging validation. Docker was not available for an actual Compose run. Configuration was reviewed, not certified by deployment.
4. Chromium was tested; Firefox, WebKit, physical devices, screen-reader audits, external penetration testing and measured Core Web Vitals were not performed. Representative XSS/input tests are not a comprehensive exploit campaign.
5. MFA has a fail-closed readiness flag, not a working enrollment/TOTP flow. No active MFA claim is made. Password reset email requires the configured email provider.
6. Final price/stock, delivery rates/coverage, approved policy content, usage instructions and label/formula/claim reconciliation remain client inputs. Publishing policies and enabling checkout are deliberate admin actions. No legal adequacy or product certification is claimed.
7. The regex secret scan and package audit cover their stated patterns/dependency database, not every possible secret or vulnerability. Runtime logs/monitoring, retention policies and provider infrastructure remain operator responsibilities.

Exact environment variables, bridge payloads, client accounts and launch gates are listed in `SETUP.md` and `.env.example`.

## Vercel / Supabase / manual-payment phase

This phase replaces production filesystem writes with server-only Supabase Storage, prepares PostgreSQL pooling for serverless runtime, removes card and Bosta from the customer flow, and adds COD, InstaPay and Vodafone Cash states. Product images are public sanitized WebP assets; payment proofs are isolated in a private bucket and streamed only after admin authorization.

Focused test result: **5 passed, 0 failed**. The suite covers schema migration/RLS, server-priced COD/manual checkout, price tampering, customer proof ownership/IDOR, invalid uploads, authorized confirm/reject transitions, duplicate transition rejection, stock restoration, audit attribution, product add/archive/reactivate and Supabase-backed image add/replace/delete. TypeScript, ESLint and the final Next.js production build passed. The repository scan checked 66 source/configuration files with no findings; `npm audit` reported 0 vulnerabilities; the built client assets contain no `SUPABASE_SERVICE_ROLE_KEY` reference.

Focused review found two deployment-specific issues and remediated both before retest: the original CSP would have blocked Supabase product images and a configured InstaPay QR, so it now permits only the exact HTTPS origins from server configuration; and Supabase Data API roles could otherwise depend on project defaults, so migration 003 enables RLS on every application table without public policies. The application continues to use its server-only PostgreSQL connection and authorized API routes.

Remaining limitations: no live Supabase/Vercel deployment or real manual transfer was performed; Storage bucket configuration, Supabase network/TLS behavior, Vercel runtime limits and final access policies require staging verification with client-owned accounts. This review is scoped to changed code and is not a claim of complete security.

## Customer accounts, ownership and payment UX phase

This was a focused review of the new customer authentication, account ownership, saved-address and QR/manual-payment changes. It was **not** the final production security audit.

| Targeted verification | Result |
|---|---|
| Customer account/API tests | 7 passed, 0 failed: registration, bcrypt cost 14, duplicate registration, generic invalid login, session rotation/invalidation, logout, password change, hashed expiring single-use reset, authenticated/guest checkout, history/detail access, guest-order claim and customer/admin separation |
| Ownership/IDOR tests | Passed: Customer B received 404 for Customer A order detail, order-success API, address update/delete and proof/order access; guest orders required both reference and private tracking key and could not be transferred after ownership |
| Manual-payment/storage tests | 7 passed, 0 failed: COD, InstaPay/Vodafone configuration with/without safe QR, server-authoritative total, proof MIME/ownership, reference submission, prohibited customer status/amount fields, admin verification/rejection, duplicate transition safety and audit attribution |
| Browser/UI checks | 75 route/responsive checks passed on Chromium at 1440/768/390 with no recorded page errors; a final focused 20-check rerun covered account registration, saved address, InstaPay/Vodafone QR/copy, reference submission, order history/detail and reduced motion after responsive CSS changes |
| Static/build checks | ESLint, TypeScript and Next.js production build passed; the focused secret-pattern scan checked 71 files with no findings |

The bcrypt cost-14 benchmark in this runtime averaged approximately 1.2 seconds per hash and was retained as requested. Customer and admin identities use mutually exclusive server-side session columns enforced by a database constraint. Customer order queries require `orders.account_id` ownership; historical guest orders are never attached by email or phone. Manual-payment customers can submit a reference or private proof but cannot update payment state or order totals.

Remaining phase limitations: email delivery was not configured, so the reset UI remains generic and provider delivery requires staging credentials; QR images and receiving identifiers used only safe non-production test fixtures; no live transfer, Vercel deployment, Supabase project, physical-device/browser matrix or final external attack suite was performed.
