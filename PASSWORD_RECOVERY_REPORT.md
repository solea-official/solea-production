# SOLÉA password recovery — implementation and verification report

Date: 30 October 2026. Baseline: `5a13ef0` (the delivered final storefront updates). This report describes repository work and local verification, not a production deployment or confirmed external mailbox delivery.

## Confirmed causes in the supplied code

1. Both customer and admin reset-request handlers could return success without sending anything when email configuration was missing. The customer path additionally required `EMAIL_ENABLED=true`; the admin path used inconsistent checks.
2. The only sending integration was a custom HTTPS `/send` adapter. There was no SMTP transport; Supabase Auth did not send these emails.
3. Provider errors were swallowed after deleting the reset token. Users and operators had no useful failure signal or durable retry record.
4. Customer/admin accounts use separate custom PostgreSQL password tables and sessions. Supabase Auth settings, default sender restrictions and PKCE are not the active recovery architecture. No OAuth implementation was found.
5. Resetting an authenticated account revoked its session while the browser could retain its stale CSRF value. A fresh anonymous cookie/CSRF pair now avoids a first-login failure.

Production Vercel environment values, provider logs, Supabase production logs and sender DNS were not accessible. Therefore the precise live configuration/provider failure remains unverified. The repository defects above are confirmed; no claim is made that a specific live provider bounced or suppressed an email.

## Implemented

- Shared server-only SMTP transport using Nodemailer 10.3.1, strict certificate verification, TLS/STARTTLS, bounded timeouts, no transport debug logging, and no arbitrary attachment URL/file access. Resend SMTP configuration is documented; existing HTTPS adapter deployments remain supported.
- Sender-verification configuration gate. Disabled/missing configuration returns the same safe 503 for registered and unknown emails. A brief shared transport-failure circuit avoids repeated silent requests during an SMTP outage.
- Durable recovery jobs in the existing PostgreSQL outbox. Next.js `after()` attempts delivery immediately on Vercel. Transactional claims, bounded retry attempts, expiry and sanitized failures are available to the existing authorized Integration Jobs UI. Its existing audited retry action now triggers recovery processing. The existing worker and maintenance endpoint can process due recovery jobs.
- Emails go only to the active account's registered address, regardless of recipient domain. Unknown addresses produce the same public acknowledgement and no email. There is no Gmail-specific restriction or separate provider integration.
- English and Arabic HTML/plain-text recovery emails, using SOLÉA colors and the requested content. New links put the credential in a URL fragment, removed into memory by the page; no token in new server request URLs, client storage or logs. Legacy query links remain accepted for compatibility.
- Existing 30-minute hashed single-use reset storage, bcrypt cost 14, CSRF, role separation and audit architecture retained. Inactive accounts cannot reset. Successful resets revoke all existing account sessions/tokens, return only an anonymous session and require password login. Authenticated customer password changes also invalidate outstanding recovery links.
- Both recovery forms now include password confirmation and show/hide controls, the existing server password policy, loading/duplicate-submit protection, bilingual generic acknowledgement, service errors and invalid/expired-link guidance. Forms remount between customer authentication modes to avoid stale success state disabling login.
- Recovery pages use `no-referrer` in addition to existing noindex/private-cache/CSP protections. `/admin` remains a non-disclosing 404.
- `npm run email:check` provides a sanitized TLS/authentication diagnostic without sending email.

No account migration, database schema change, destructive cleanup or production migration was performed. No Paymob, cart totals, bundle prices, inventory, shipping, coupons, reporting baseline, images, approved content or manual payment verification code was changed. `scripts/grants.ts` and migrations 001–013 are unchanged.

## Verified checks

| Check | Actual result |
|---|---|
| `npm run lint` | Pass, no errors/warnings |
| `npm run typecheck` | Pass |
| `npm run test` | **126 passed, 0 failed, 0 skipped** |
| `npm run build` | Pass, production Next.js build |
| `npm run security:scan` | Pass, no findings |
| `git diff --check` | Pass |
| `npm audit` | **Not clean: 4 existing-package vulnerabilities, 1 critical and 3 high** |

Nineteen new tests cover recovery APIs/security (14), a real local TLS SMTP protocol interaction (1), and bilingual customer/admin browser recovery forms (4). The local SMTP fixture sends only to a captured test server, tests multipart mail and rejects an untrusted TLS certificate. API tests use an isolated migrated PostgreSQL-compatible fixture and mocked provider delivery for Gmail/Outlook/Yahoo/Hotmail/custom-domain recipient routing; they do not send external mail.

Tests cover invalid/expired/reused tokens, old/new password behavior, session revocation and immediate login with refreshed anonymous CSRF, admin role preservation, customer/admin token separation, inactive accounts, nonexistent accounts, strict input validation, origin/CSRF, distributed identifier throttling across IPs, provider authentication/timeouts/recipient rejection, bounded retries, duplicate worker claims, expired jobs, and private recovery headers. The complete pre-existing regression suite also passed, including Paymob, manual payments/WhatsApp, customer IDOR, checkout, admin deletion, reporting, storage, Our Story and storefront changes.

Browser tests ran in Chromium at 1366×900 and 390×844, with English/LTR and Arabic/RTL. Actual rendered customer/admin recovery screenshots were inspected; no overflow or page errors were observed. Real Android Chrome, iPhone Safari, branded desktop Chrome and inbox email-client rendering were **not** tested. No screenshots containing credential fields are included in the deliverables.

## Production delivery and deployment status

**Not deployed. Real email delivery remains unverified.** No production Vercel project/token, database URL, SMTP credentials, verified sender identity, provider/DNS access or authorized accessible test mailboxes were available. None was invented or exposed.

| Item | Status |
|---|---|
| Resend SMTP implementation | Added and locally tested |
| Live SMTP credentials / sender approval | Requires owner configuration and verification |
| SPF / DKIM / DMARC | Exact provider records and live verification still required |
| Supabase Auth URL/template changes | Not applicable to these custom accounts; none made |
| Actual Gmail delivery | Not tested |
| Actual non-Gmail delivery | Not tested |
| Actual admin mailbox reset | Not tested |
| Vercel production deployment | Not performed |
| Provider bounce/suppression monitoring | Must be enabled/reviewed in provider dashboard |

See `PASSWORD_RECOVERY_SETUP.md` for exact variables, provider/DNS steps, diagnostic and release acceptance. Set secrets directly in the trusted Vercel/server environment, not in chat or source control. Use `APP_URL=https://soleababy.com`. Select a real verified sender address under the authorized domain; do not invent one.

For timely outage recovery, configure the documented authenticated external scheduler or existing worker. The committed Vercel Hobby daily schedule is unchanged and is **not sufficient for timely retry** within a 30-minute request window. Normal requests receive an immediate serverless attempt. Each scheduler call handles one due recovery job, so size frequency/capacity for actual volume. SMTP acceptance is audited separately from delivery; later bounces/suppression must be checked in Resend's dashboard. No provider delivery webhook was added, and no guaranteed inbox placement is promised.

Use authorized disposable customer/admin accounts with Gmail and a second provider, then verify provider acceptance, actual inbox/spam arrival, link completion, new/old password behavior and unchanged roles/orders. Follow the detailed acceptance checklist before enabling this in production.

## Dependency findings outside this targeted fix

The audit reported existing versions of Next.js (critical), Sharp (high), Zod (high) and source-map-js (high). No advisory was reported against the added Nodemailer dependency. Existing framework/library versions were retained to avoid an unrelated untested upgrade. Do not treat this build as having passed a dependency security audit; plan and test the upstream fixes before deployment. The audit suggested Next.js 16.4.3, Sharp 0.35.5 and Zod 4.6.7, plus the patched source-map-js release. These are audit suggestions, not upgrades performed here.

## Files changed

- `.env.example`
- `PASSWORD_RECOVERY_REPORT.md`
- `PASSWORD_RECOVERY_SETUP.md`
- `SUPABASE_SETUP.md`
- `VERCEL_DEPLOYMENT.md`
- `package-lock.json`
- `package.json`
- `scripts/email-check.ts`
- `scripts/scan.mjs`
- `scripts/worker.ts`
- `src/app/[...slug]/page.tsx`
- `src/app/api/[...path]/route.ts`
- `src/components/account.tsx`
- `src/components/admin.tsx`
- `src/components/password-recovery.tsx`
- `src/components/provider.tsx`
- `src/proxy.ts`
- `src/server/customer-auth.ts`
- `src/server/email.ts`
- `src/server/integrations.ts`
- `src/server/password-recovery.ts`
- `src/server/recovery-email.ts`
- `tests/browser/navigation.ts`
- `tests/password-recovery-smtp.test.ts`
- `tests/password-recovery-ui.test.ts`
- `tests/password-recovery.test.ts`

## Delivery packages

The complete project ZIP contains the existing application plus these corrections and documentation. The targeted patch contains only the listed modified/new files relative to `5a13ef0`. No deleted files or new migrations are required. Patch compatibility is for that exact delivered baseline; review newer production changes before overlaying it. ZIP validation reconstructs the full source from that baseline plus the patch and compares every file byte-for-byte.

Both ZIPs exclude real environment files/credentials, dependencies, `.next`, temporary files, build artifacts, logs and screenshots. Existing safe `.env.example` is included. Neither packaging nor installing applies migrations or deploys production.
