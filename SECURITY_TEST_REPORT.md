# SOLÉA — security and delivery verification

## Result and scope

The existing implementation was continued incrementally. The delivered source contains the bilingual Next.js storefront, server API, PostgreSQL schema/migrations, secure role-based admin, product/image/content/settings management, persistent cart, server-priced checkout, COD orders, tracking, audit records and background integration jobs. Prices, stock and shipping are not invented; launch gates remain closed until configured.

This is a record of performed checks, not a security certification or a claim that the application is ready for unrestricted live trading.

| Verification already completed                                                                                              | Result                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` — unit, database/API, authorization, commerce and adapter tests                                                  | 37 tests passed; 0 failed/skipped                                                                                                               |
| `npm run test:e2e` — real production React components and API handlers through intercepted browser requests                 | 52 checks passed; Chromium, desktop 1440px, tablet 768px, mobile 390px; no recorded page errors                                                 |
| `npm run test:runtime` — actual production Next server over local HTTPS, real cookies, PostgreSQL wire connection to PGlite | 23 checks passed; routes, headers, 404, protected admin, login, product creation, cart, COD order and Arabic switching; no recorded page errors |
| `npm run typecheck` and `npm run lint`                                                                                      | Passed                                                                                                                                          |
| `npm run build`                                                                                                             | Passed after the final application changes; production build artifact present                                                                   |
| Repository secret-pattern scan                                                                                              | No findings in scanned source/configuration; environment values are placeholders or generated during setup/tests                                |
| `npm audit --json` — final confirmation                                                                                     | 0 reported vulnerabilities across 490 audited dependencies                                                                                      |

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

| Finding                                                                                        | Severity                 | Remediation                                                                                          | Retest                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Payment arriving after an expired/cancelled card reservation had no refund path                | High, commerce integrity | Record capture, leave order cancelled, queue one idempotent full refund; do not re-reserve stock     | Passed                                               |
| bcrypt character limit did not enforce its UTF-8 byte limit                                    | Medium                   | Reject password input above 72 UTF-8 bytes at creation/reset/login; bootstrap password prompt hidden | Regression passed; build passed                      |
| Cart add replaced the current quantity                                                         | Medium, functional       | Add through a serialized transaction; retain PUT for setting/removing quantity                       | Passed                                               |
| No operator action to record collected COD                                                     | Medium, operational      | Owner-only delivered-COD collection, audited and single transition                                   | Passed                                               |
| Unknown admin resource returned generic 500; malformed UTF-8 was not rejected explicitly       | Low                      | Typed 404 error and fatal UTF-8 decoding with bounded input                                          | Passed                                               |
| Streamed missing-page response returned 200; rewrite failed behind local HTTPS proxy           | Low                      | Explicit branded 404 response with security headers; validate missing product slugs                  | Production HTTPS and proxy checks passed             |
| robots sitemap URL could be captured at build time                                             | Low                      | Dynamic robots generation using runtime APP_URL                                                      | Build/runtime route review passed                    |
| Failed integration jobs required an operational retry path                                     | Medium, operational      | Owner-only retry endpoint/UI with audit trail                                                        | Passed                                               |
| Test browser disabled web security and omitted Origin; test HTML missed UTF-8 charset          | Test harness only        | Restore Chromium web security and set UTF-8; production CSRF validation left strict                  | Browser login/checkout and RTL retested successfully |
| Build cache/test bundle polluted lint scope; runtime TypeScript config risked dev-only tooling | Tooling                  | Ignore generated artifacts, use runtime JS Next config, retain tsx as production script dependency   | Lint/typecheck/build passed                          |

## Remaining production limitations and blockers

1. **Bosta and email remain optional generic provider contracts.** Paymob now has a native hosted intention/callback layer, but client-owned sandbox credentials, callback registration, dashboard reconciliation and provider UAT are still required before activation.
2. No production credentials were supplied and no live Paymob transaction, refund, manual transfer, shipment or email was sent. Remote idempotency and final settlement must be verified in staging with the chosen services.
3. Database tests used PGlite, including its TCP multiplexer. Native PostgreSQL multi-connection locking/deadlocks, load/failover, container startup, Caddy certificate issuance, Cloudflare client-IP trust and backup restoration require staging validation. Docker was not available for an actual Compose run. Configuration was reviewed, not certified by deployment.
4. Chromium was tested; Firefox, WebKit, physical devices, screen-reader audits, external penetration testing and measured Core Web Vitals were not performed. Representative XSS/input tests are not a comprehensive exploit campaign.
5. Mandatory administrator TOTP enrollment is implemented in migration 007; migration 008 removes the retired alternative-code storage. Production still requires setting the dedicated encryption key, applying the migration and enrolling each privileged user. Password reset email requires the configured email provider.
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

| Targeted verification        | Result                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer account/API tests   | 7 passed, 0 failed: registration, bcrypt cost 14, duplicate registration, generic invalid login, session rotation/invalidation, logout, password change, hashed expiring single-use reset, authenticated/guest checkout, history/detail access, guest-order claim and customer/admin separation |
| Ownership/IDOR tests         | Passed: Customer B received 404 for Customer A order detail, order-success API, address update/delete and proof/order access; guest orders required both reference and private tracking key and could not be transferred after ownership                                                        |
| Manual-payment/storage tests | 7 passed, 0 failed: COD, InstaPay/Vodafone configuration with/without safe QR, server-authoritative total, proof MIME/ownership, reference submission, prohibited customer status/amount fields, admin verification/rejection, duplicate transition safety and audit attribution                |
| Browser/UI checks            | 75 route/responsive checks passed on Chromium at 1440/768/390 with no recorded page errors; a final focused 20-check rerun covered account registration, saved address, InstaPay/Vodafone QR/copy, reference submission, order history/detail and reduced motion after responsive CSS changes   |
| Static/build checks          | ESLint, TypeScript and Next.js production build passed; the focused secret-pattern scan checked 71 files with no findings                                                                                                                                                                       |

The bcrypt cost-14 benchmark in this runtime averaged approximately 1.2 seconds per hash and was retained as requested. Customer and admin identities use mutually exclusive server-side session columns enforced by a database constraint. Customer order queries require `orders.account_id` ownership; historical guest orders are never attached by email or phone. Manual-payment customers can submit a reference or private proof but cannot update payment state or order totals.

Remaining phase limitations: email delivery was not configured, so the reset UI remains generic and provider delivery requires staging credentials; QR images and receiving identifiers used only safe non-production test fixtures; no live transfer, Vercel deployment, Supabase project, physical-device/browser matrix or final external attack suite was performed.

## Product polish and Paymob phase

This phase adds Paymob's hosted intention flow without enabling it by default. Checkout totals and line items are rebuilt from locked database product, inventory, coupon and shipping records. Provider credentials remain server-only. The Paymob transaction callback requires the configured SHA-512 HMAC, merchant/provider-order correlation, integration-ID allowlisting, exact EGP minor-unit amount matching and a valid server-side state transition. Webhook event IDs and payload hashes provide replay-safe, conflict-detecting idempotency; stock is released once on failed or expired reservations.

| Targeted verification | Result |
| --- | --- |
| Account, COD and manual-payment regression | 14 passed, 0 failed |
| Paymob/admin/serverless-maintenance security tests | 9 passed, 0 failed: disabled configuration, database-authoritative amount, forged/mismatched HMAC rejection, valid/failed callbacks, replay idempotency, stock restoration, customer status denial, protected expiry route, generic admin throttling and multi-device sessions |
| Browser/UI checks | 77 responsive route/flow checks plus a final focused 20-check gallery/account/payment rerun; Chromium at 1440/768/390, English/Arabic, reduced motion; 0 recorded page errors |
| Production runtime checks | 25 passed over the actual Next production server with HTTPS, PostgreSQL wire transport and real cookies; includes `/ingredients` 404, sitemap cleanup, public ingredient-field omission, hidden admin discovery, COD confirmation and route/header checks |
| Static/build checks | ESLint passed; TypeScript passed; optimized Next production build passed; secret scan checked 76 files with 0 findings |

Migration `006_paymob_and_polish.sql` preserves historical records while adding Paymob provider references, payment-method support, the draft distance-selling content entry and the approved four-image gallery mapping. Targeted checks cover disabled/misconfigured Paymob, server-authoritative intention amounts, invalid and valid callback HMACs, wrong amount/integration/order rejection, successful and failed status transitions, duplicate callback behavior, unauthorized customer payment-state mutation, COD/manual-payment regression, the private proof path, removed public admin discovery and ingredient-route/content removal. This is a scoped review of modified areas, not the final external production security audit.

Staging still requires real client-owned Paymob sandbox credentials, merchant payment-method integration IDs, callback registration, provider dashboard reconciliation and end-to-end success/failure/refund testing. Vercel WAF rules, production monitoring/alerts, Supabase backup recovery and the final domain smoke test remain manual production tasks; none are claimed active here.

## Security hardening and authenticated-order phase

Migration `007_security_hardening.sql` adds encrypted administrator TOTP state, pending MFA sessions, privileged idle tracking and explicit first/last-name customer profile fields. Existing privileged sessions are invalidated. New orders require an authenticated, profile-complete customer; historical guest orders and private-key tracking remain available.

Final repository verification for this phase: **66 tests passed, 0 failed**, including mandatory MFA/pending-session denial, OTP brute-force throttling, invalid OTP and TOTP replay rejection, incomplete-profile checkout denial, old `/admin` non-disclosing 404, sensitive noindex/no-store headers, account/order/address IDOR, the Paymob `orderId` redirect regression, server-authoritative checkout and unchanged Paymob webhook protections. New administrator hashes and administrator reset hashes use bcrypt cost 14. The Vercel Hobby maintenance schedule is verified as once daily. ESLint, TypeScript, optimized production build and secret scan passed; the full `npm audit` reported 0 vulnerabilities.

## Bilingual Our Story and TOTP-only admin update

Current verification: **69 tests passed, 0 failed, 0 skipped**. ESLint, TypeScript and production build passed. New Chromium checks cover exact English copy, full Arabic translation, language switching, RTL and overflow at 1440/768/390 px, navigation capitalization and authenticator-only admin UI. API tests reject retired recovery-code fields and confirm the former endpoint returns 404, while valid TOTP, QR enrollment, replay protection and MFA throttling still work. A separate upgrade fixture applies migrations 001–007, stores an enrolled encrypted authenticator, applies 008, and verifies its ciphertext and counters remain intact and the authenticator still validates. Paymob and customer authentication/ownership regressions passed unchanged.

Migration 008 is applied after the TOTP-only application replaces older instances; see `SETUP.md`. No live database migration, deployment, real payment or final production audit was performed.


## Reporting baseline and mandatory manual payment verification — 2026-10-28

Scope: migration-010 baseline extended with additive migration 011. This is a focused review of changed reporting/manual-payment code, not a full production audit.

- Final suite: **93 tests passed, 0 failed**. `npm run lint`, `npm run typecheck`, `npm run build`, `npm run security:scan` and `git diff --check` passed.
- New API/database coverage: backup-gated reset, immutable history, zero new-cohort totals, restore, CSRF/RBAC, stale/concurrent resets, restricted runtime grants, paid-only revenue, duplicate/concurrent approval, mandatory proof and sender/amount, amount/status tampering, cross-order denial, private proof authorization, 60-second signed URL generation, evidence-version conflict, correction without extra stock deduction, transfer-reference reuse, pending-review filter and incomplete-order expiry once.
- Browser coverage: InstaPay and Vodafone Cash upload/form/copy-fallback/WhatsApp flow in English and Arabic; customer widths 1440/768/390; admin reporting controls and explicit approval attestation; admin widths 1440/768/390. Real components were rendered with isolated API fixtures. The screenshot bytes in browser transport fixtures are not a security test; real image decoding, re-encoding and rejection are tested separately by API tests.
- Existing Paymob HMAC, amounts, orderId redirect, replay/idempotency, COD, password-only admin auth, admin deletion, customer authentication/order/address IDOR, uploads and bilingual Story tests continue to pass.
- Findings fixed: backup receipt SELECT lock incorrectly required runtime UPDATE privilege (removed unnecessary lock on immutable receipts, no extra grant); outdated assertion omitted selected transfer columns (corrected test projection); admin navigation min-content overflow at mobile width (local grid min-width fix). Targeted retests and final full suite passed.
- Environment issue: bundled Chromium extraction initially failed on container `chown`; the existing browser archive was extracted without changing ownership and tests ran with `CHROMIUM_PATH=/tmp/chromium`. No application control or assertion was disabled.
- PGlite integration tests use serialized connections. These exercise transaction/state guards but do not replace concurrent load testing against the actual Supabase pooler. Browser tests use Chromium, not physical iPhone/Android WhatsApp apps.
- Not performed: live Supabase/Storage access, real backup/restore drill, production reset, Vercel deployment, real money transfer, WhatsApp delivery verification, independent receiver identity verification, or final production security audit. No credentials were available for these tasks. The backup CLI's real pg_dump path remains to be validated by the operator; archive listing alone is not a recovery drill.
- Operational residuals: the private proofs bucket and deployed database grants must be checked; signed URLs are bearer access until their short expiry; optional/customer-entered transaction references cannot prove money receipt; admin must reconcile the real ledger and WhatsApp manually. Storage cleanup failures can leave an inaccessible orphan object requiring operator cleanup, without marking a committed upload failed. Keep production backups encrypted and outside this repository.
