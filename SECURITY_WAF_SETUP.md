# Vercel Firewall / WAF setup

## Implemented in code

- Database-backed rate limits cover administrator/customer login, registration, password reset, checkout, payment submission, tracking, uploads, newsletters and Paymob callbacks.
- Provider callbacks require Paymob HMAC validation and are not protected by browser CSRF.
- Sensitive pages return `noindex, nofollow` and `private, no-store`; API responses use `no-store`.
- CSP, HSTS in production, anti-framing, `nosniff`, referrer and permissions policies are emitted by `src/proxy.ts`.

## Required in the Vercel dashboard before Go-Live

1. Enable Vercel Firewall managed rules for common web attacks and keep DDoS protection enabled.
2. Add rate rules for `/api/auth/login`, `/api/account/login`, `/api/account/register`, `/api/account/reset-request`, `/api/track`, `/api/checkout` and upload routes. Start in log mode, validate real traffic, then challenge or deny abusive clients. Application limits remain authoritative.
3. Exclude `/api/webhooks/paymob` from browser challenges. Do not create an undocumented source-IP allowlist; HMAC is the callback trust control. A coarse flood rule may still apply above normal provider retry volume.
4. Apply bot challenges to repeated credential-stuffing and scanning patterns, not to normal storefront navigation or search-engine access to public pages.
5. Configure alerts/log drain for sustained 401, 403, 429 and 5xx spikes, checkout failures and invalid webhook signatures. Restrict log access and retention.
6. Scope production secrets to Production. Preview deployments must use test databases, Paymob test credentials and separate session keys.

| Endpoint class | Identity | Application limit | Window | Response |
| --- | --- | ---: | ---: | --- |
| Admin login account | IP + normalized email | 5 | 15 min | 429 |
| Admin login distributed | normalized email | 30 | 15 min | 429 |
| Customer login | IP + normalized email | 5 | 15 min | 429 |
| Registration / reset | IP | 5 | 1 hour | 429 |
| Public tracking | IP | 10 | 5 min | 429 |
| Checkout | session/customer | 10 | 5 min | 429 |
| Payment proof | session/customer | 5 | 1 hour | 429 |
| Paymob webhook | source request stream + HMAC | 300 | 1 min | 429 |

After the final domain is attached, confirm HTTPS and HSTS behavior, firewall rule hits, Paymob callback delivery, and false-positive rates before enabling production orders.

### Administrator deletion

Implemented in code: `DELETE /api/admin/users/:id` requires the existing `users` permission, an active password-authenticated administrator session, same-origin CSRF validation. Additional PostgreSQL-backed limits are **5 attempts per administrator per 5 minutes across all sessions/IPs**, and **15 attempts per IP per 5 minutes**, returning 429. Successful attempts count to bound destructive operations. Existing Vercel trusted-IP handling is reused. No dashboard/firewall settings were changed by this feature.

Retired `/api/auth/mfa/*` paths return 404. Remove obsolete path-specific MFA dashboard rate rules when deploying this update; retain administrator login and mutation protection.
