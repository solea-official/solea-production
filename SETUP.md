# SOLÉA setup

Requires Node.js 22.9+ and a Supabase project. Final price, stock, shipping zones/rates, manual-payment receiving details and approved policies are intentionally unconfigured; checkout remains closed until the admin configures valid business data.

## Local run

1. `npm ci` and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `DIRECT_DATABASE_URL`, `APP_URL`, `SESSION_SECRET` and the Supabase Storage server values.
3. `npm run db:migrate && npm run db:seed && npm run admin:create`
4. `npm run dev`

Product images are uploaded to the public product bucket. Payment proofs are stored in a separate private bucket and can be read only through the authorized admin endpoint. No writable local persistent filesystem is required. Docker files remain optional for isolated local development only.

Customer registration, server-side sessions, order history, guest-order claiming and saved addresses are enabled after migration `004_customer_accounts.sql`. Guest checkout and private-key order tracking remain available. Customer passwords use bcrypt cost 14; the local serverless benchmark was approximately 1.2 seconds per hash. Password-reset tokens are hashed, single-use and expire after 30 minutes; delivery requires the optional email adapter below.

## Store configuration

In `/admin`, set a confirmed integer-money price, stock and active shipping zones/fees; publish approved bilingual legal content; enable COD as needed; then enable orders. InstaPay and Vodafone Cash receiving identifiers and optional QR image URLs are server environment settings, not admin-entered secrets. Manual orders remain `Awaiting Confirmation` until an authorized admin confirms or rejects them. Customers cannot set payment status.

Email is optional. With `EMAIL_ENABLED=false` or missing adapter credentials, order creation continues without an email job. Historical card/Bosta adapter code remains isolated for record compatibility, but the customer checkout and production deployment do not depend on either service.

See `SUPABASE_SETUP.md` and `VERCEL_DEPLOYMENT.md` for the target hosting setup. Do not connect the final domain or accept live orders until deferred business values, owner credentials, policy approvals and production smoke/security checks are complete.
