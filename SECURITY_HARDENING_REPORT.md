# SOLÉA security hardening report

This report covers repository controls and local automated verification. It is not the final production penetration test or a claim of perfect security.

## Authentication

- Customer and administrator identities remain separate database/session principals.
- Administrator login uses email/password and immediately rotates into an authorized server-side session. Admin MFA was removed by explicit request; no second-factor or recovery-code authentication remains. Password hashes remain bcrypt cost 14.
- Session identifiers rotate after password login and password changes. Cookies are HttpOnly, SameSite=Lax and Secure in production; privileged idle timeout is 30 minutes with a two-hour absolute lifetime.
- `/admin` returns 404 without redirecting. `/ops-portal` is defense-in-depth only; all API authorization remains server-side RBAC.

## Authorization, IDOR and privacy

- Account orders, addresses and proofs use authenticated ownership predicates. Historical guest order claiming requires the order reference plus a 256-bit private tracking key.
- New checkout requires an authenticated, active customer with first name, last name and mobile. Address/delivery fields remain server validated. Historical guest orders remain intact.
- Admin mutations require server-side permissions. Privileged user/session changes require a password-authenticated session less than ten minutes old and are audit logged.
- Responses select customer-safe fields; password hashes, tracking hashes and provider secrets are not returned.

## Rate limiting, CSRF and request validation

- Rate limits are stored in PostgreSQL, so they work across Vercel instances. Login combines IP/account and distributed-account buckets; tracking, resets, checkout, uploads and provider callbacks have separate limits.
- Cookie-authenticated state changes require a session-derived CSRF token and exact configured Origin. Paymob callbacks use HMAC rather than browser CSRF.
- Zod strict schemas reject unknown privileged fields, invalid enums/ranges and oversized values. JSON and multipart bodies have explicit size ceilings.

## XSS, CSP, headers and cache

- React escaping is used for user/admin content. The only structured-data HTML sink serializes server data and escapes `<`.
- CSP limits scripts to per-request nonces/strict-dynamic, disallows objects and framing, and upgrades insecure production requests. Production sends HSTS, `nosniff`, strict-origin referrer policy and a restrictive permissions policy.
- Account, checkout, tracking and backoffice pages return `noindex, nofollow` and `private, no-store`. API and private proof responses use `no-store`.

## Database and Supabase

- SQL calls are parameterized. Runtime uses a restricted `solea_app` role; schema/DDL and destructive audit/history operations remain unavailable. Owner/direct database credentials are migration-only.
- Public product media and private payment proofs use separate Supabase Storage buckets. Uploads require authorization, size/MIME/magic-byte validation, decode/re-encode to WebP, generated paths and no SVG/executable acceptance.
- `SUPABASE_SERVICE_ROLE_KEY`, database URLs and payment keys are server-only and forbidden from `NEXT_PUBLIC_*` use.

## Payment, webhook and tracking

- Existing Paymob pricing, aggregate line item, amount equality, HMAC validation, integration allowlist, reference matching, idempotency, rollback and late-payment safeguards remain unchanged.
- Browser input cannot set prices, totals, shipping, discounts or payment state. Public tracking requires both reference and high-entropy private key and returns a generic miss.

## Logging and errors

- Login/password, privileged mutations, order/payment transitions and historical order claims create audit events without passwords or provider secrets.
- Public errors are stable codes; unexpected failures expose only a request ID while server logs omit request bodies and secrets.

## Dependency and secret security

- Deterministic `package-lock.json` is included; `node_modules` and build output are excluded from delivery.
- Previous audit results are historical; the current targeted release results are recorded in `CHANGELOG_REMOVE_ADMIN_TOTP.md`. The exclusively MFA QR dependencies were removed without upgrading other dependencies.

## Automated tests performed

- Customer registration/login/logout/password/reset, ownership and address IDOR, historical order claims, customer/admin separation and authenticated checkout.
- Direct password sessions, retired MFA endpoint denial, login throttling, secure administrator deletion, bcrypt cost 14, security headers, old-route 404, RBAC, CSRF, brute-force limits and database grants.
- Authenticated profile-complete checkout, coupon/stock integrity, Paymob amount/HMAC/reference/replay/failure behavior, `orderId` redirect handling, manual-payment proof privacy and admin-only confirmation.
- Upload MIME/content/size/path protections, malformed/oversized input and secret scan.

## Remaining operational controls and risks

- Apply `SECURITY_WAF_SETUP.md` in the Vercel dashboard; repository code cannot enable those controls.
- Configure Supabase backups/PITR, restore drills, Storage bucket policies, log retention/alerts and least-privilege operator access in the client-owned dashboards.
- Apply migration 010 only in the coordinated upgrade described in `SETUP.md`. Migrations 001–009 are unchanged; no runtime MFA encryption key is required.
- Perform final production smoke tests, Paymob callback tests, domain/HSTS verification and the separately planned Astra Max audit before Go-Live.
- Current validation results are in `CHANGELOG_REMOVE_ADMIN_TOTP.md`. This targeted change is not the final production audit.
- Password compromise now suffices to authenticate an administrator: the removed second factor no longer provides an additional barrier. Retained server-side rate limits, session controls, RBAC and operational monitoring remain necessary.
