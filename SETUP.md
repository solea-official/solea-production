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

In `/ops-portal`, complete mandatory authenticator enrollment, store the one-time recovery codes offline, then set a confirmed integer-money price, stock and active shipping zones/fees; publish approved bilingual legal content; enable COD as needed; then enable orders. The former `/admin` path returns 404. InstaPay and Vodafone Cash receiving identifiers and optional QR image URLs are server environment settings. Manual orders remain `Awaiting Confirmation` until an authorized admin confirms or rejects them.

Paymob is disabled by default. To use its hosted Unified Checkout, configure `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, a provider-issued `PAYMOB_HMAC_SECRET` of at least 32 characters, and the comma-separated `PAYMOB_INTEGRATION_IDS`; register `APP_URL/api/webhooks/paymob` as the transaction notification URL, complete sandbox verification, and only then set `PAYMOB_ENABLED=true`. The server creates intentions from database prices and verifies Paymob callbacks before setting an order to paid. Never expose these values through `NEXT_PUBLIC_*` variables.

Email is optional. With `EMAIL_ENABLED=false` or missing adapter credentials, order creation continues without an email job. Historical card/Bosta adapter code remains isolated for record compatibility, but the customer checkout and production deployment do not depend on either service. Paymob uses its native hosted flow rather than the historical generic card bridge.

See `SUPABASE_SETUP.md` and `VERCEL_DEPLOYMENT.md` for the target hosting setup. Do not connect the final domain or accept live orders until deferred business values, owner credentials, policy approvals and production smoke/security checks are complete.

The checked-in Vercel Cron schedule is daily at `03:00 UTC`. More frequent reservation maintenance requires Vercel Pro or an external scheduler configured with `CRON_SECRET`.
