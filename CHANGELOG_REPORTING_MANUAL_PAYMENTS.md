# SOLÉA reporting and manual-payment changelog

## Delivered

- Reversible, audited PostgreSQL reporting baseline with backup receipt gate. No frontend hardcoded zeros and no history/stock reset.
- Existing InstaPay/Vodafone Cash flow extended with receiving number/copy feedback, mandatory private screenshot, sender phone and amount, bilingual WhatsApp instructions, and provisional-order wording.
- Server-owned WhatsApp message generation; no payment authority from clicks or uploads.
- Authorized admin evidence review, exact-amount comparison, WhatsApp/received-funds attestation, rejection/correction, immutable decision metadata and version/concurrency safeguards.
- Private signed-proof URL endpoint and pending-manual-review filter. Small admin grid fix prevents mobile overflow.
- Backup operator script and additive `011_reporting_and_manual_verification.sql`; migrations 001–010 are unchanged. Apply 011 then refresh grants before deployment. See `REPORTING_MANUAL_PAYMENTS.md` for activation and rollback details.
- New environment gates: `INSTAPAY_RECIPIENT_VERIFIED` and `VODAFONE_CASH_RECIPIENT_VERIFIED`. Supplied receiver values are in `.env.example`; activation remains disabled until merchant verification.

## Actual validation

93/93 automated tests passed, including three new browser workflow tests. Lint, typecheck, production build, repository secret scan and diff whitespace check passed. The complete files in this archive match the tested code. No dependencies or images were changed. Paymob implementation, checkout calculations, stock reservation implementation, existing migrations, daily Vercel schedule and package-lock are unchanged.

No production migration, backup, statistics reset, receiving-account activation or deployment was performed. Production Supabase/Vercel credentials were unavailable. The actual number's receiving capability and live WhatsApp setting still require merchant verification. No real iPhone/Android transfer or WhatsApp delivery is claimed. See the security report for test boundaries.

## API changes

- `GET/POST /api/admin/reporting`: owner-permission reporting view/reset/restore.
- `POST /api/payment-proof`: required private evidence with ownership/state checks.
- `POST /api/payment-submission`: strict senderPhone/transferredAmount/reference; does not accept payment status.
- `GET /api/payment-whatsapp?orderId=…&locale=…`: owned, complete evidence only; returns a prepared message link without updating status.
- `GET /api/admin/orders/:id/payment-proof-url`: payment-permission, short-lived signed access.
- `POST /api/admin/orders/:id/confirm-payment`: submissionVersion plus explicit WhatsApp/funds attestations.
- `POST /api/admin/orders/:id/reject-payment`: submissionVersion, reason, optional allowCorrection.
- Admin order list supports `paymentReview=pending`. Existing authenticated maintenance handles untouched manual reservations as documented.

## Modified files

- `.env.example`
- `SECURITY_TEST_REPORT.md`
- `SETUP.md`
- `SUPABASE_SETUP.md`
- `VERCEL_DEPLOYMENT.md`
- `package.json`
- `scripts/grants.ts`
- `src/app/api/[...path]/route.ts`
- `src/app/globals.css`
- `src/components/admin.tsx`
- `src/components/checkout.tsx`
- `src/components/provider.tsx`
- `src/server/admin-api.ts`
- `src/server/customer-api.ts`
- `src/server/manual-payments.ts`
- `src/server/storage.ts`
- `tests/helpers.ts`
- `tests/paymob.test.ts`
- `tests/vercel-supabase-manual.test.ts`

## Added files

- `REPORTING_MANUAL_PAYMENTS.md`
- `migrations/011_reporting_and_manual_verification.sql`
- `scripts/reporting-backup.ts`
- `src/components/manual-payment.tsx`
- `src/components/reporting.tsx`
- `src/server/manual-submissions.ts`
- `src/server/reporting.ts`
- `tests/manual-payment-ui.test.ts`
- `tests/reporting-manual-upgrade.test.ts`
- `CHANGELOG_REPORTING_MANUAL_PAYMENTS.md`
