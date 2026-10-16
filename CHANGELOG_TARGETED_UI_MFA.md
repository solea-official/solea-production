# SOLÉA — bilingual story and TOTP-only admin MFA

## Changes

- Our Story uses the existing English/Arabic language switch. Approved English copy and intentional line breaks are unchanged; Arabic preserves its meaning and paragraph structure. Local RTL typography uses the existing Arabic font family.
- The previously removed Our Story image remains removed; no `/media/box.png` image is rendered on the Our Story page.
- Navigation, mobile menu, footer and homepage link display `Our Story` in English.
- Admin authentication remains password → authenticator TOTP → authorized session. QR enrollment, encrypted secrets, replay counters, MFA enforcement, session rotation, CSRF, rate limits and audit events remain in place.
- Removed admin MFA recovery-code generation, hashing/verification, alternate login field, setup display, regeneration UI, API endpoint and response/type fields. Strict input validation rejects the retired fields; retired MFA endpoints return 404. Customer password reset is unchanged.
- Paymob, checkout totals, stock, shipping, coupons, customer accounts, runtime database permissions, secrets/configuration, assets and existing migrations 001–007 are unchanged.

## Files modified

- `src/components/storefront.tsx` — bilingual story and homepage link capitalization.
- `src/components/provider.tsx` — shared navigation/footer capitalization.
- `src/app/globals.css` — story-only RTL typography.
- `src/components/admin.tsx` — TOTP-only UI.
- `src/server/admin-mfa.ts` — TOTP-only enrollment/verification.
- `src/app/api/[...path]/route.ts` — strict TOTP input/output and removal of regeneration route.
- `tests/helpers.ts` — authenticator-only test login fixture; test clock advances to fresh intervals without relaxing replay protection.
- `tests/security-hardening.test.ts` — TOTP replay, rejected recovery-code input, removed endpoint, migration and encrypted-secret preservation assertions.
- `SETUP.md`, `VERCEL_DEPLOYMENT.md` — precise upgrade/rollback instructions.
- `SECURITY_HARDENING_REPORT.md`, `SECURITY_TEST_REPORT.md` — current MFA behavior and verification results.

## Files added

- `migrations/008_remove_admin_mfa_recovery_codes.sql`
- `tests/story-mfa-ui.test.ts`
- `CHANGELOG_TARGETED_UI_MFA.md`

## Migration / deployment order

Existing installation through 007: deploy this TOTP-only application, ensure old instances are no longer serving, then apply 008 using the existing trusted migration process. It removes only `admin_users.recovery_hashes`; existing ciphertext, TOTP replay counters, enrollment status, sessions and audit logs are preserved. Do not edit or rerun 007 and do not rotate `ADMIN_MFA_ENCRYPTION_KEY`.

The new application works with both the 007 and 008 schemas. Older recovery-code-aware code is incompatible after 008; rollback must retain the TOTP-only implementation. Fresh installations apply 001–008 in numerical order before startup. No production migration or deployment was performed. No environment variables were added or changed.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test`: 69 passed, 0 failed, 0 skipped.
- `npm run build`: passed.
- Browser tests: exact English paragraphs and line breaks; full Arabic paragraphs; real language switching; desktop/tablet/mobile at 1440/768/390 px; RTL and horizontal overflow checks; header/mobile/footer capitalization; authenticator-only enrollment/login/security UI. Screenshots reviewed locally; excluded from the ZIP.
- API/database tests: QR generation; no alternative-code response fields; password-only session denial; valid TOTP; replay rejection; OTP throttling; removed endpoint 404 for anonymous/customer/admin callers; migration preserves decryptable enrolled secrets. Existing RBAC, least-privilege, Paymob, checkout, customer reset and order/address ownership tests passed.

Tests use local isolated databases and provider fixtures. This is a targeted regression check, not a live production audit. Vercel/Supabase deployment verification remains an operator task.
