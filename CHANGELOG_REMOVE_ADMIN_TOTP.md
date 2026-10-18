# SOLÉA — Remove admin TOTP only

## Changes

- Admin email/password authentication now rotates directly into the secure administrator session and opens `/ops-portal`. There is no intermediate challenge, enrollment, QR setup or authenticator input. Retired authentication endpoints return 404; no recovery-code or SMS substitute exists.
- Removed the admin MFA/TOTP modules and their exclusive `qrcode` / `@types/qrcode` dependency trees. No remaining package versions were upgraded.
- Removed OTP input and verification from administrator deletion. The strict request is now `DELETE /api/admin/users/:id` with JSON `{}`. Permission (`users`), CSRF/origin validation, PostgreSQL-backed 5/account and 15/IP per 5-minute limits, self/last-manager checks, transaction locking, session/reset-token cleanup, durable historical identities and immutable deletion audit events remain.
- Admin sessions retain HttpOnly, production Secure, SameSite=Lax, rotation, revocation, 30-minute idle and two-hour absolute limits. Existing account/role/session management retains its ten-minute recent-login requirement, now based on server session creation time. Password hashes remain bcrypt cost 14.
- `scripts/grants.ts` assigns DIRECT_DATABASE_URL to DATABASE_URL before dynamically importing the database module, as requested. Grants and RLS policies are unchanged.
- `ADMIN_MFA_ENCRYPTION_KEY` is no longer read or required; removed its example entry. No real secrets, Paymob values or other environment-variable names were changed.

## Migration and deployment

Added `010_remove_admin_totp_mfa.sql`; migrations 001–009 are byte-for-byte unchanged. Apply 010 after 009 using the existing migration runner and trusted migration credentials. It revokes unfinished challenges, replaces the identity-preservation deletion trigger and removes obsolete admin MFA/session columns. It preserves accounts, hashes, roles, completed sessions, audit/payment/order history and customer data.

This is a forward-only schema change, incompatible with the old MFA application. Back up and rehearse against a database copy. In a coordinated maintenance window, drain old instances, run `npm run db:migrate` and `npm run db:grants`, then promote this application. See SETUP.md. No production migration, deployment, push or secret change was performed here. Rollback to the old application alone is unsafe after 010.

## Targeted patch

Baseline: `SOLEA-production-secure-admin-deletion.zip`
SHA-256: `5cf21c8a5c1efdc2b9a927e8c37f814c534da77ad878b1c79abf5416501435f1`.

The patch contains modified/new files only. Overlay it on that exact baseline, then run `node scripts/remove-retired-admin-mfa.mjs` from the project root before `npm ci`. This removes the two retired source files only when their hashes match the baseline; unexpected newer contents abort removal. Do not apply this overlay blindly to a different/newer production tree. The complete ZIP already excludes those files.

Patch verification: baseline + overlay + guarded removals reproduces every complete-project file byte-for-byte. No secrets, node_modules, .next, temporary files or build outputs are included.

## Validation

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run test`: **82 passed, 0 failed, 0 skipped**.
- `npm run build`: PASS (Next.js production build).
- `git diff --check HEAD`: PASS against the migration-009 baseline in a separate local review repository (the supplied project has no Git metadata).
- `npm run security:scan`: PASS, no findings.
- Updated tests cover direct password login without an MFA key, session rotation/logout/multiple devices/idle and absolute expiry, recent authentication, old endpoint rejection, code-free deletion, authorization, CSRF, rate limits, self/last-manager checks, concurrent reciprocal requests, rollback, audit/history preservation, restricted runtime grants and migration preservation.
- Chromium checks cover the login and deletion interfaces plus unchanged English/Arabic Our Story at desktop/tablet/mobile sizes. Existing Paymob, customer identity/ownership, checkout, upload and security regressions pass.
- Database tests use isolated PGlite; real multi-process lock contention and production Vercel/Supabase smoke testing remain deployment checks. No external live transactions were performed. This is not a full production audit.

## Scope verification

Assets, storefront/Our Story content, customer services, checkout, commerce totals/stock, Paymob code, proxy/security headers and Vercel configuration match the baseline byte-for-byte. Historical release reports remain explicitly labeled as superseded history. Customer password recovery remains intact.

Removing the second factor is the requested behavior: a compromised administrator password no longer faces an additional authenticator check. Retained authorization, session, CSRF, throttling and audit protections remain in place.

## Files modified

- `.env.example`
- `CHANGELOG_ADMIN_ACCOUNT_DELETION.md`
- `CHANGELOG_TARGETED_UI_MFA.md`
- `SECURITY_HARDENING_REPORT.md`
- `SECURITY_WAF_SETUP.md`
- `SETUP.md`
- `SUPABASE_SETUP.md`
- `VERCEL_DEPLOYMENT.md`
- `package-lock.json`
- `package.json`
- `scripts/grants.ts`
- `scripts/runtime-check.ts`
- `scripts/ui-check.ts`
- `src/app/api/[...path]/route.ts`
- `src/app/ops-portal/[[...path]]/page.tsx`
- `src/components/admin.tsx`
- `src/components/provider.tsx`
- `src/server/admin-accounts.ts`
- `src/server/admin-api.ts`
- `src/server/security.ts`
- `tests/admin-deletion-concurrency.test.ts`
- `tests/admin-deletion-ui.test.ts`
- `tests/admin-deletion.test.ts`
- `tests/browser/entry.tsx`
- `tests/helpers.ts`
- `tests/security-hardening.test.ts`
- `tests/story-mfa-ui.test.ts`

## Files added

- `migrations/010_remove_admin_totp_mfa.sql`
- `scripts/remove-retired-admin-mfa.mjs`
- `CHANGELOG_REMOVE_ADMIN_TOTP.md`

## Files removed

- `src/server/admin-mfa.ts`
- `src/server/totp.ts`
