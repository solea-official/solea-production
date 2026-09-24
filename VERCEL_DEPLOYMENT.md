# Vercel deployment preparation

1. Import the repository into Vercel and use Node.js 22. The build command is `npm run build`; no Docker runtime is required.
2. Configure the application runtime variables from `.env.example`, but do not add the database-owner `DIRECT_DATABASE_URL` to Vercel; keep it only in the trusted migration workstation/CI secret scope. Use separate Supabase projects or databases for preview and production. Configure the optional InstaPay/Vodafone QR URLs and Paymob credentials only as server environment values; no service-role or payment value uses a `NEXT_PUBLIC_` variable. Use a provider-issued Paymob HMAC secret of at least 32 characters and set a separate 32-byte-or-longer `CRON_SECRET`; Vercel sends it to the protected reservation-maintenance route.
3. Before deployment, run migrations from a trusted workstation or CI with the database-owner `DIRECT_DATABASE_URL`: `npm ci && npm run db:migrate && npm run db:seed`. Provision the server-only `solea_app` login, run `npm run db:grants` as the owner, then configure Vercel `DATABASE_URL` with that restricted role. Never run forward migrations concurrently.
4. Set `APP_URL` to the assigned HTTPS Vercel URL for the target environment. Add the final domain only after Go-Live approval.
5. Deploy and verify `/api/health`, storefront routes, protected admin routes, checkout methods, the configured Vercel Cron execution and Storage upload/download behavior. For Paymob, register `https://<deployment>/api/webhooks/paymob`, validate sandbox success/failure callbacks and duplicate delivery, then enable it separately per environment.
6. For rollback, redeploy the last known-good immutable Vercel deployment. Database migrations are forward-only: take a Supabase backup before migration and use a tested corrective migration instead of deleting migration history.

Use the Supabase transaction-pooler URL for `DATABASE_URL` and a direct/session URL for `DIRECT_DATABASE_URL`. Product media and payment proofs use Supabase Storage; the Vercel filesystem is not used for persistent data.

Vercel platform protections and rate limiting in the application are not a substitute for a configured WAF. Before Go-Live, review Vercel Firewall/Attack Challenge settings, trusted proxy headers, log retention, alerting and Supabase point-in-time recovery/backups in the client-owned accounts.
