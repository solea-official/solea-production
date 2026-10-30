# SOLÉA password recovery and email setup

## Architecture — do not migrate accounts

SOLÉA uses its existing PostgreSQL `customer_accounts` and `admin_users` password/session system. Supabase provides PostgreSQL and Storage; Supabase Auth does **not** own these identities. Changing Supabase Auth SMTP, Site URL, PKCE or email templates alone cannot fix these recovery flows. Do not create duplicate Auth users or switch to `resetPasswordForEmail` / `updateUser` for these accounts. Google OAuth is not implemented in this baseline; a Gmail address is still a SOLÉA email/password account, and this flow never resets a Google password.

Customer: `/account/forgot` → `/api/account/reset-request` → emailed `/account/reset#token=…` → `/api/account/reset` → sign in.

Admin: `/ops-portal` Forgot password → `/api/auth/reset-request` → emailed `/ops-portal?reset=1#token=…` → `/api/auth/reset` → password login with unchanged role. A reset never creates a privileged session.

Reset credentials are random 256-bit values, SHA-256 hashed in the existing reset tables, valid for 30 minutes, and consumed transactionally. Successful reset invalidates all reset credentials and sessions for that account and returns a fresh anonymous cookie/CSRF pair so immediate password login works without stale recovery-session state. Bcrypt remains cost 14. Reset pages consume the fragment into memory and remove it from browser history; neither localStorage nor sessionStorage stores credentials. Previously issued query links remain accepted, but all new links use fragments. Do not capture request bodies, fragments, full reset URLs or email contents in analytics/logging. Reopening the email is required if the reset page is refreshed after its fragment is cleared.

No database migration or production data reset is required by this change. Existing migrations 001–013 are unchanged. No Supabase Auth dashboard changes are required; if another application uses Supabase Auth, keep its configuration intact.

## Configure one transactional provider

Preferred: Resend SMTP. Existing verified HTTPS email adapters remain supported with `EMAIL_PROVIDER=adapter`; do not replace a functioning provider unnecessarily. Credentials are server-only and must never use `NEXT_PUBLIC_`.

1. In the authorized Resend account add `soleababy.com` or an owner-approved sending subdomain. Add **exactly the generated DNS records** shown by Resend for DKIM, SPF and its return-path/MX requirements. Do not replace existing inbound-mail MX records. Never publish two SPF records at the same hostname; coordinate existing senders with your DNS/mail administrator.
2. Configure DMARC for the sending domain with the domain owner. Start with a reviewed monitoring policy, then tighten it after legitimate senders pass alignment checks. Use only a real, monitored reporting mailbox if configuring `rua`; do not invent one. DMARC/SPF/DKIM values and selectors depend on the real provider/domain configuration.
3. Wait for Resend's domain status to be **Verified**. Select a real approved sender address under that domain with the display name `SOLÉA Support`. No address is provisioned by this repository.
4. Create a scoped sending API key for that domain. Disable open/click tracking for authentication mail so the fragment link is preserved. Check suppression/bounce history and sending limits before enabling delivery.
5. Set Vercel **Production** variables, redeploy, and keep Preview credentials separate:

| Variable | Value |
|---|---|
| `APP_URL` | `https://soleababy.com` (origin only) |
| `EMAIL_ENABLED` | `true` after verification |
| `EMAIL_PROVIDER` | `smtp` |
| `EMAIL_DOMAIN_VERIFIED` | `true` only after provider verification |
| `EMAIL_FROM` | `SOLÉA Support <actual approved sender address>` |
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` (implicit TLS) or `587` (required STARTTLS) |
| `SMTP_USER` | `resend` |
| `SMTP_PASSWORD` | real scoped Resend API key, securely entered |

`EMAIL_API_KEY` and `EMAIL_ADAPTER_URL` are legacy adapter-only values and are unused for SMTP. No Paymob, Supabase, session or CRON secret changes are required. TLS certificate verification remains enabled; 2465/2587 are also supported. There is no recipient-domain allowlist. Registered Gmail, Outlook, Yahoo, Hotmail and custom-domain addresses use the same sending path.

Run `npm run email:check` in a trusted environment with the actual production SMTP configuration. It verifies the TLS connection and SMTP authentication without sending email. Passing this check does not prove sender approval, email acceptance or mailbox delivery.

## Delivery jobs and operational errors

Both request endpoints require CSRF, strict input validation and PostgreSQL-backed limits: 5 requests/IP/hour and 5 requests/normalized account identifier/hour. Confirmation endpoints retain 10 attempts/IP/hour. No email-domain special cases exist.

Missing/disabled email configuration produces the same HTTP 503 `EMAIL_UNAVAILABLE` for existing and nonexistent addresses. A short, shared circuit also returns 503 after transport-wide authentication/connection failures; individual recipient failures never alter public account-existence responses. HTTP 429 remains the rate-limit response.

Requests enter the existing `outbox` as `password-reset-email` jobs. The generic public response acknowledges the request; it does **not** prove delivery. Next.js `after()` immediately attempts the requested job on Vercel. Jobs contain only audience, account ID (or null for an unknown address), and language — no submitted email address, password, raw token or reset URL. The current registered email is read when sending. Done jobs clear payloads. Accepted SMTP submission is audited as `password.recovery-email-accepted`, not delivered.

The worker claims each job transactionally with a two-minute lease. There are at most three automatic attempts. Failed SMTP submissions remove their generated reset hash; successful password use consumes all outstanding credentials. SMTP cannot guarantee exactly-once delivery if a connection dies after acceptance; a subsequent attempt can send another message. There are never duplicate password updates from one token. Failures store only an allowlisted error code; raw provider replies are never logged. Permanent SMTP authentication/5xx recipient/message failures stop automatic retries. Temporary failures become eligible after two minutes. Requests older than 30 minutes expire instead of sending unexpectedly late mail.

The existing `/ops-portal/jobs` permission-controlled UI exposes failed job IDs/codes and its audited retry action schedules a new attempt. For expired requests, the customer must request a fresh link; retrying stale jobs does not send mail. Provider errors and worker failures are logged without credentials, recipients or message bodies.

The existing daily Hobby cron also processes one due recovery job as a fallback. **Daily cron is insufficient for timely retry after an outage.** For automatic retries within the token window, configure an authenticated external scheduler to call the existing `/api/internal/maintenance` with `Authorization: Bearer <existing CRON_SECRET>` every 1–2 minutes, or use the existing trusted worker process. The endpoint retains its existing order/payment-expiry maintenance behavior. Do not put the secret in the URL. Review scheduler capacity: one due recovery job is processed per call. Vercel Hobby's committed daily schedule is unchanged; higher-frequency Vercel cron requires an appropriate plan. No external scheduler has been configured by this change.

## Delivery status, bounces and provider rejection

SMTP acceptance means the provider accepted the message, not that the recipient received it. In Resend's Emails dashboard find the test recipient/time and inspect Delivered, Bounced, Suppressed or Failed status and any provider explanation. SMTP sends appear there. Check spam folders with the mailbox owner. A hard bounce or suppression must be investigated in the provider account; do not repeatedly retry a permanently invalid mailbox or remove suppressions without correcting the cause. The application must not publicly disclose these recipient-specific outcomes. Late delivery/bounce events are not automatically mirrored into SOLÉA: use the provider dashboard/alerts; no unauthenticated delivery webhook has been introduced. No guaranteed inbox placement is possible.

## Required release acceptance

Use authorized disposable SOLÉA test accounts and real accessible mailboxes (one Gmail and one other provider), including a separate test admin with a recorded existing role. Do not change real customer/admin credentials for testing.

1. Request recovery in English and Arabic; inspect request status and safe Vercel job logs. Confirm provider acceptance, then provider delivery status, **then actual arrival** in each mailbox.
2. Check sender/domain authentication in the received message headers (SPF, DKIM, DMARC). Check HTML/text, RTL, mobile rendering and unmodified fragment links. Never paste a reset link into logs or support tickets.
3. Open the correct customer/admin page, set a policy-compliant password and sign in. Check old password fails, old sessions are revoked, account/orders and admin role are unchanged. Check expired, invalid and reused links fail and offer a new request.
4. Check nonexistent addresses receive the same generic response; verify limits, CSRF, provider outage, recipient rejection and retry visibility. Test desktop Chrome, Android Chrome and iPhone Safari with real devices where available.
5. Confirm `/admin` remains 404 and `/ops-portal` remains protected. Run the repository regression suite before release.

Production verification is blocked until authorized provider/DNS/Vercel access and those test mailboxes are available. Supabase Auth logs are not evidence for this custom-account flow; inspect Vercel application logs, PostgreSQL outbox/audit metadata and the transactional provider instead.

## Official references

- https://resend.com/docs/send-with-smtp
- https://resend.com/docs/dashboard/domains/introduction
- https://nodemailer.com/smtp
- https://nextjs.org/docs/app/api-reference/functions/after
