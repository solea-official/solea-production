# SOLÉA — secure administrator account deletion

## Changes

- Added `Delete Admin` to Admin users in `/ops-portal`, visible only to account managers and hidden for the acting account. The bilingual native confirmation dialog shows email/role, explains permanent deletion, requests the acting administrator's fresh six-digit authenticator code, handles safe errors and prevents duplicate submission. Cancel receives initial focus; keyboard cancellation is available before submission.
- Added `DELETE /api/admin/users/:id` with a strict `{ code }` body. Uses the existing `users` permission, mandatory MFA-completed session, CSRF/origin checks and existing TOTP decryption/verification. No new role, authentication mechanism, key or environment variable.
- PostgreSQL limits: 5 deletion attempts per acting admin/5 minutes across sessions and IPs; 15 per IP/5 minutes. Errors return safe 400/401/403/404/409/429 responses.
- Self-deletion is blocked. A transaction locks `admin_users`, revalidates the actor/session/permissions, verifies remaining active `users`-permission holders, consumes a fresh TOTP counter, deletes the account and records the audit event. Existing account creation/role-change transactions share this lock and authorization recheck so a concurrent deletion cannot leave a previously authorized request with stale administrative privileges.
- `ADMIN_ACCOUNT_DELETED` preserves actor email and deleted admin ID/email/role. `ADMIN_ACCOUNT_DELETE_DENIED` records authenticated, CSRF-valid failed attempts after rollback without storing submitted codes. Existing authentication and CSRF rejection behavior is preserved.

## Database / historical integrity

New migration: `009_secure_admin_account_deletion.sql`. Migrations 001–008 are byte-for-byte unchanged.

`admin_identities` retains only an ID/email/role snapshot and deletion timestamp. Existing audit `actor_id` and payment `verified_by` values now reference this durable table. Existing audit rows and payment records are not rewritten or cascaded away. Admin audit/payment displays continue resolving the former administrator's email.

A fixed SECURITY DEFINER trigger, with a fixed `pg_catalog` search path and schema-qualified statements, maintains identity rows. Public function execution is revoked. Runtime access to historical identities is SELECT-only under RLS; audit history remains append-only. `scripts/grants.ts` adds DELETE only on `admin_users`, with the existing role-specific RLS grant pattern. It grants no runtime DDL or direct historical identity writes.

Deletion removes the admin account/password hash/encrypted TOTP secret and admin reset tokens. All full and pending admin sessions are expired and detached; pending enrollment ciphertext and MFA markers are cleared. Session rows are retained because historical carts/orders may reference them. No customer authentication/reset records, orders or payment records are removed.

## Apply / rollback

1. Confirm the supplied baseline and review local changes before overlaying the patch. It contains full replacement versions of changed files; do not blindly overwrite a divergent production checkout.
2. Back up the database. From a trusted migration environment, apply migrations in numeric order; existing installations at 008 apply only 009 using `npm run db:migrate`.
3. Reapply `npm run db:grants` with DATABASE_URL explicitly set to the migration/role-management connection. Keep runtime DATABASE_URL restricted to `solea_app`.
4. Deploy the new code after migration/grants. The existing application remains compatible with 009 if an application rollback is needed; do not reverse 009 after any deletion.
5. Keep ADMIN_MFA_ENCRYPTION_KEY and all existing production secrets unchanged. No production migration, secret change, push or deployment was performed for this deliverable.

The original baseline ZIP is `SOLEA-production-bilingual-story-totp-only.zip`, SHA-256 `862e872f64f35a5c6b3b647f925ce73ff38efd4482b43ce297342e2c8211d820`.

## Files modified

- `src/server/admin-api.ts` — protected deletion dispatch, account-change serialization, historical actor display.
- `scripts/grants.ts` — historical identity read access and admin deletion permission.
- `src/components/admin.tsx` — permission-aware button and TOTP confirmation dialog.
- `src/components/provider.tsx` — bilingual safe error messages.
- `src/app/globals.css` — scoped destructive button/dialog styles.
- `SETUP.md` — migration, grants and rollback order.
- `SECURITY_WAF_SETUP.md` — deletion endpoint limits; no dashboard configuration claimed.

## Files added

- `src/server/admin-accounts.ts` — transactional authorization, TOTP and deletion service.
- `migrations/009_secure_admin_account_deletion.sql` — identity preservation and authentication cleanup trigger.
- `tests/admin-deletion.test.ts` — authorization, CSRF, TOTP/replay, rate limits, history, session/reset revocation, rollback, grants and migration tests.
- `tests/admin-deletion-concurrency.test.ts` — simultaneous reciprocal deletion requests cannot remove both account managers.
- `tests/admin-deletion-ui.test.ts` — rendered dialog, permissions, focus, error handling, duplicate submission and responsive checks.
- `CHANGELOG_ADMIN_ACCOUNT_DELETION.md` — this change and deployment record.

## Validation

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test`: **80/80 passed**, zero failures or skipped tests (11 new tests; all 69 existing tests retained).
- `npm run build`: passed (Next.js production build).
- `npm run security:scan`: 91 files checked, zero findings.
- `git diff --check`: passed against an isolated Git review tree created from the exact baseline ZIP (the supplied project has no Git metadata).
- Browser regression and visual review: confirmation dialog at desktop 1440px, tablet 768px and mobile 390px; keyboard focus/cancel, error feedback, busy state and duplicate-submission protection checked.
- Existing Paymob, checkout, customer IDOR, TOTP/QR, recovery-code rejection, bilingual Our Story, old `/admin` 404, bcrypt cost 14 and security tests pass.
- Patch overlay: applying the targeted ZIP to the supplied baseline reproduces the complete project byte-for-byte. Unchanged files include all images, Our Story, migrations 001–008, TOTP crypto/login implementation, customer account/checkout/payment services, security headers, Vercel/Supabase configuration, environment example and dependency lockfile.

Limitations: concurrency regression runs concurrent API requests against the existing PGlite serialized transaction harness. Real multi-process PostgreSQL lock contention was not exercised: this environment cannot create/switch to the OS user required by native PostgreSQL. Verify the new migration/grants and simultaneous administrator actions in a non-production Supabase staging environment before deployment. No full production security audit or live-provider test is claimed.
