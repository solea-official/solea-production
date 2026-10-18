# SOLÉA setup

Requires Node.js 22.9+ and a Supabase project. Final price, stock, shipping zones/rates, manual-payment receiving details and approved policies are intentionally unconfigured; checkout remains closed until the admin configures valid business data.

## Local run

1. `npm ci` and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `DIRECT_DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY` and the Supabase Storage server values.
3. Using `DIRECT_DATABASE_URL`, run `npm run db:migrate && npm run db:seed && npm run admin:create`. Provision the server-only `solea_app` login role, then run `npm run db:grants` as the database owner and use that role in `DATABASE_URL`.
4. `npm run dev`

Product images are uploaded to the public product bucket. Payment proofs are stored in a separate private bucket and can be read only through the authorized admin endpoint. No writable local persistent filesystem is required. Docker files remain optional for isolated local development only.

Customer registration, server-side sessions, order history, historical guest-order claiming and saved addresses are enabled after migration `004_customer_accounts.sql`. New checkout requires an authenticated customer with first name, last name and mobile; historical guest orders and private-key public tracking remain supported. Customer passwords use bcrypt cost 14. Password-reset tokens are hashed, single-use and expire after 30 minutes; delivery requires the optional email adapter below.

## Store configuration

In `/ops-portal`, complete mandatory authenticator enrollment, then set a confirmed integer-money price, stock and active shipping zones/fees; publish approved bilingual legal content; enable COD as needed; then enable orders. The former `/admin` path returns 404. InstaPay and Vodafone Cash receiving identifiers and optional QR image URLs are server environment settings. Manual orders remain `Awaiting Confirmation` until an authorized admin confirms or rejects them.

Paymob is disabled by default. To use its hosted Unified Checkout, configure `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, a provider-issued `PAYMOB_HMAC_SECRET` of at least 32 characters, and the comma-separated `PAYMOB_INTEGRATION_IDS`; register `APP_URL/api/webhooks/paymob` as the transaction notification URL, complete sandbox verification, and only then set `PAYMOB_ENABLED=true`. The server creates intentions from database prices and verifies Paymob callbacks before setting an order to paid. Never expose these values through `NEXT_PUBLIC_*` variables.

Email is optional. With `EMAIL_ENABLED=false` or missing adapter credentials, order creation continues without an email job. Historical card/Bosta adapter code remains isolated for record compatibility, but the customer checkout and production deployment do not depend on either service. Paymob uses its native hosted flow rather than the historical generic card bridge.

See `SUPABASE_SETUP.md` and `VERCEL_DEPLOYMENT.md` for the target hosting setup. Do not connect the final domain or accept live orders until deferred business values, owner credentials, policy approvals and production smoke/security checks are complete.

The checked-in Vercel Cron schedule is daily at `03:00 UTC`. More frequent reservation maintenance requires Vercel Pro or an external scheduler configured with `CRON_SECRET`.

## TOTP-only update (migration 008)

For an existing installation through migration 007: deploy this application release first and ensure older application instances are no longer serving traffic. Then run `npm run db:migrate` from trusted migration tooling. Migration `008_remove_admin_mfa_recovery_codes.sql` removes only the retired backup-code column. It leaves existing TOTP ciphertext, counters, enrollment state, sessions and audit history intact. Do not change `ADMIN_MFA_ENCRYPTION_KEY`; existing authenticators do not need re-enrollment. No new environment variables are required.

The new code works both before and after migration 008. Older code that queries the removed column is incompatible after 008; rollback must use a TOTP-only release. On a fresh database, apply migrations 001–008 in order before starting the app. Do not run migrations automatically during Vercel builds. Admin login requires the authenticator; losing access requires the operator's controlled identity-verification procedure. Password reset alone does not bypass MFA. No public MFA-reset endpoint is added.

### Secure administrator deletion (migration 009)

For an installation already at 008: back up the database, apply `009_secure_admin_account_deletion.sql` through `npm run db:migrate` using the trusted migration connection, then rerun `npm run db:grants` with **DATABASE_URL set to the migration/role-management connection**. Deploy the updated application only after those steps. Keep the normal runtime DATABASE_URL restricted to `solea_app`. Fresh installs apply 001–009 in order, then grants.

009 adds credential-free historical admin identities and repoints audit/payment foreign keys without changing their existing IDs or records. The deletion trigger expires/detaches admin sessions (retaining rows needed by historical orders/carts), clears pending MFA setup state and deletes admin password-reset tokens. The account row, password hash and encrypted TOTP secret are permanently removed on deletion. Enrolled accounts that are not deleted are unchanged. No new environment variables; never change ADMIN_MFA_ENCRYPTION_KEY for this upgrade.

The migration is compatible with the previous application: it can remain installed during an application rollback. Do not reverse the identity migration or restore a deleted administrator as an application rollback. Account deletion is irreversible through the UI; disaster recovery requires a separately reviewed database recovery procedure. The migration runner records successful migrations; do not execute this migration repeatedly by hand.
