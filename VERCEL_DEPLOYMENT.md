# Vercel deployment preparation

1. Import the repository into Vercel and use Node.js 22. The build command is `npm run build`; no Docker runtime is required.
2. Configure the application runtime variables from `.env.example`, including independent 32-byte `SESSION_SECRET` and `CRON_SECRET` values. Do not add the database-owner `DIRECT_DATABASE_URL` to Vercel; keep it only in trusted migration CI. Scope production secrets to Production only and use a separate Supabase project/database and Paymob test credentials for Preview.
3. For a fresh installation, run migrations from a trusted workstation or CI with the database-owner `DIRECT_DATABASE_URL`: `npm ci && npm run db:migrate && npm run db:seed`. Provision the server-only `solea_app` login, run `npm run db:grants` as the owner, then configure Vercel `DATABASE_URL` with that restricted role. Never run forward migrations concurrently.
4. Set `APP_URL` to the assigned HTTPS Vercel URL for the target environment. Add the final domain only after Go-Live approval.
5. Deploy and verify `/api/health`, storefront routes, `/admin` returning 404, password authentication and RBAC at `/ops-portal`, authenticated checkout, the configured Vercel Cron execution and Storage upload/download behavior. For Paymob, register `https://<deployment>/api/webhooks/paymob`, validate sandbox success/failure callbacks and duplicate delivery, then enable it separately per environment.
6. For rollback, redeploy the last known-good immutable Vercel deployment. Database migrations are forward-only: take a Supabase backup before migration and use a tested corrective migration instead of deleting migration history.

The included Vercel Cron runs reservation maintenance once daily at `03:00 UTC` (`0 3 * * *`), which is compatible with the current Hobby-plan frequency limit. Higher-frequency maintenance requires Vercel Pro or a separately secured external scheduler calling the same authenticated maintenance endpoint. Do not shorten the schedule on Hobby.

Use the Supabase transaction-pooler URL for `DATABASE_URL` and a direct/session URL for `DIRECT_DATABASE_URL`. Product media and payment proofs use Supabase Storage; the Vercel filesystem is not used for persistent data.

Apply `SECURITY_WAF_SETUP.md` in the Vercel project before Go-Live. Dashboard controls, log drains, alerts and Supabase backup/PITR settings are operational tasks and are not activated by repository code.

For an existing deployment, use the coordinated migration-010 maintenance sequence in `SETUP.md`; old MFA application instances cannot run after its column removal. No new secrets are required. Do not change Paymob configuration. The retired MFA encryption key is no longer read by the application.

## Reporting and mandatory manual-payment review (migration 011)

For the migration-010 production baseline, follow `REPORTING_MANUAL_PAYMENTS.md`. Apply additive migration 011 and refreshed runtime grants before promoting this release. Never run `db:seed` against existing production data. The reporting reset is a separate, backup-gated, audited action; extraction, migration and deployment do not reset statistics. Manual methods additionally require the new per-method `*_RECIPIENT_VERIFIED` flags after real receiving-account verification. Preserve existing Paymob credentials and daily Vercel Cron.
