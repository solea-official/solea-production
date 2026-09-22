# Vercel deployment preparation

1. Import the repository into Vercel and use Node.js 22. The build command is `npm run build`; no Docker runtime is required.
2. Configure all Production/Preview environment variables from `.env.example`. Use separate Supabase projects or databases for preview and production.
3. Before deployment, run migrations from a trusted workstation or CI with `DIRECT_DATABASE_URL`: `npm ci && npm run db:migrate && npm run db:seed`. Never run forward migrations concurrently.
4. Set `APP_URL` to the assigned HTTPS Vercel URL for the target environment. Add the final domain only after Go-Live approval.
5. Deploy and verify `/api/health`, storefront routes, protected admin routes, checkout methods and Storage upload/download behavior.
6. For rollback, redeploy the last known-good immutable Vercel deployment. Database migrations are forward-only: take a Supabase backup before migration and use a tested corrective migration instead of deleting migration history.

Use the Supabase transaction-pooler URL for `DATABASE_URL` and a direct/session URL for `DIRECT_DATABASE_URL`. Product media and payment proofs use Supabase Storage; the Vercel filesystem is not used for persistent data.
