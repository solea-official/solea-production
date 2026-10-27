# SOLÉA setup

Requires Node.js 22.9+ and a Supabase project. Final price, stock, shipping zones/rates, manual-payment receiving details and approved policies are intentionally unconfigured; checkout remains closed until the admin configures valid business data.

## Local run

1. `npm ci` and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `DIRECT_DATABASE_URL`, `APP_URL`, `SESSION_SECRET` and the Supabase Storage server values.
3. Using `DIRECT_DATABASE_URL`, run `npm run db:migrate && npm run db:seed && npm run admin:create`. Provision the server-only `solea_app` login role, then run `npm run db:grants` as the database owner and use that role in `DATABASE_URL`.
4. `npm run dev`

Product images are uploaded to the public product bucket. Payment proofs are stored in a separate private bucket and can be read only through the authorized admin endpoint. No writable local persistent filesystem is required. Docker files remain optional for isolated local development only.

Customer registration, server-side sessions, order history, historical guest-order claiming and saved addresses are enabled after migration `004_customer_accounts.sql`. New checkout requires an authenticated customer with first name, last name and mobile; historical guest orders and private-key public tracking remain supported. Customer passwords use bcrypt cost 14. Password-reset tokens are hashed, single-use and expire after 30 minutes; delivery requires the optional email adapter below.

## Store configuration

In `/ops-portal`, sign in with your administrator email and password, then set a confirmed integer-money price, stock and active shipping zones/fees; publish approved bilingual legal content; enable COD as needed; then enable orders. The former `/admin` path returns 404. InstaPay and Vodafone Cash receiving identifiers and optional QR image URLs are server environment settings. Manual orders remain `Awaiting Confirmation` until an authorized admin confirms or rejects them.

Paymob is disabled by default. To use its hosted Unified Checkout, configure `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, a provider-issued `PAYMOB_HMAC_SECRET` of at least 32 characters, and the comma-separated `PAYMOB_INTEGRATION_IDS`; register `APP_URL/api/webhooks/paymob` as the transaction notification URL, complete sandbox verification, and only then set `PAYMOB_ENABLED=true`. The server creates intentions from database prices and verifies Paymob callbacks before setting an order to paid. Never expose these values through `NEXT_PUBLIC_*` variables.

Email is optional. With `EMAIL_ENABLED=false` or missing adapter credentials, order creation continues without an email job. Historical card/Bosta adapter code remains isolated for record compatibility, but the customer checkout and production deployment do not depend on either service. Paymob uses its native hosted flow rather than the historical generic card bridge.

See `SUPABASE_SETUP.md` and `VERCEL_DEPLOYMENT.md` for the target hosting setup. Do not connect the final domain or accept live orders until deferred business values, owner credentials, policy approvals and production smoke/security checks are complete.

The checked-in Vercel Cron schedule is daily at `03:00 UTC`. More frequent reservation maintenance requires Vercel Pro or an external scheduler configured with `CRON_SECRET`.

## Password-only administrator update (migration 010)

This release follows `009_secure_admin_account_deletion.sql`. New installs apply 001–010 in numeric order. Existing installations apply only the unapplied migrations using the migration runner; do not edit or rerun 001–009 manually.

For an existing deployment: back up the database and stage this complete release. In a coordinated maintenance window, stop/drain old application instances, run `npm run db:migrate` and `npm run db:grants` from trusted tooling with `DIRECT_DATABASE_URL`, then start/promote this release. Never run these steps automatically in a Vercel build. Keep runtime `DATABASE_URL` restricted to `solea_app`.

Migration 010 removes obsolete admin MFA columns, revokes unfinished login challenges, and updates the 009 deletion trigger. Accounts, password hashes, roles, completed sessions, historical identities, audit records, payments, orders and customer data are preserved. Session rows referenced by history remain; admin deletion expires/detaches the deleted admin's sessions and removes their reset tokens transactionally.

The old MFA application is incompatible after 010: do not roll back only the application to it. Test the upgrade against a database copy first; rollback requires a separately reviewed recovery plan and must not overwrite newer production transactions. No migration or deployment is performed by extracting the ZIP.

The runtime no longer reads or requires `ADMIN_MFA_ENCRYPTION_KEY`. Remove the obsolete variable from the deployment configuration after a successful coordinated upgrade if desired; do not print it or change any other secrets. Admin passwords remain bcrypt cost 14. Account creation, role changes and session revocation still require a login within the last ten minutes. Deletion requires confirmation, `users` permission, CSRF, rate limits and the existing transactional safety rules, without an OTP.

For the targeted patch, overlay only onto the matching migration-009 baseline, then run `node scripts/remove-retired-admin-mfa.mjs` to remove the two retired implementation files. The script refuses to remove unexpected newer file contents. See `CHANGELOG_REMOVE_ADMIN_TOTP.md` for the exact baseline and changed files.

## Reporting and mandatory manual-payment review (migration 011)

For the migration-010 production baseline, follow `REPORTING_MANUAL_PAYMENTS.md`. Apply additive migration 011 and refreshed runtime grants before promoting this release. Never run `db:seed` against existing production data. The reporting reset is a separate, backup-gated, audited action; extraction, migration and deployment do not reset statistics. Manual methods additionally require the new per-method `*_RECIPIENT_VERIFIED` flags after real receiving-account verification. Preserve existing Paymob credentials and daily Vercel Cron.
