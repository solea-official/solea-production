# SOLÉA — reporting and manual-payment update

## What this release changes

Migration `011_reporting_and_manual_verification.sql` extends the existing migration-010 project. It does **not** reset statistics, enable checkout or activate a payment method by itself. Migrations 001–010, products/images, pricing, shipping, coupons, Paymob code, password-only administrator authentication and customer ownership checks are unchanged.

### Reporting baseline

The existing dashboard totals come from `orders`, `order_items`, `payments`, `products` and failed `outbox` jobs. Orders, units, status counts and revenue now use `orders.created_at >= reporting_periods.starts_at`. Failed-job counts use their creation timestamp. Revenue sums each qualifying order once only when its payment is `paid`; pending, rejected and refunded payments do not count. This is an **order-cohort report**, not a payment settlement ledger: payments on orders created before the baseline stay in historical reporting even if approved later. Active product counts are deliberately preserved. This baseline had no separate customer-count KPI or sales chart to reset.

A reset uses PostgreSQL `clock_timestamp()` at the reset operation, records the acting administrator and backup receipt, and changes only `reporting_state.period_id`. Orders and payment history remain searchable. An authorized administrator can restore a previous period or all history without restoring/deleting business data. Row locking and an expected-period check reject conflicting resets. The `users` permission, CSRF, a login within ten minutes and a database-backed limit of five attempts/hour are required.

### Backup and reset procedure

1. Before migration, take the existing production database backup through your trusted Supabase/operator process and verify recovery in an isolated database. Do not include production dumps in this project or a shared ZIP.
2. Stage against a database copy. Apply unapplied migrations in numerical order through **011**, then run `npm run db:grants` with the operator-only `DIRECT_DATABASE_URL`. Do not seed an existing production database. Runtime `DATABASE_URL` stays restricted to `solea_app`.
3. Deploy this release in a coordinated maintenance window, avoiding old/new payment-review handlers running simultaneously. Migration 011 is additive; it does not drop or alter historical business rows. Do not roll the application back to an older version with optional proof approval without reviewing the resulting payment-policy downgrade.
4. On a trusted workstation with compatible PostgreSQL client tools and `DIRECT_DATABASE_URL`, run:
   `npm run reporting:backup -- /secure/backups/solea-before-reset.dump before-reporting-reset`
   The command refuses overwrite, uses mode 0600, requires successful `pg_dump`, checks the archive with `pg_restore --list`, computes SHA-256 and registers a receipt only on success. Credentials are not passed in command-line arguments or printed. This checks archive readability; it is **not** a full restore drill. Verify a restore separately before authorizing the reset. Securely retain/encrypt the dump off-site. PostgreSQL dumps do not contain Supabase Storage object bytes; retain existing Storage backups separately.
5. Sign in afresh at `/ops-portal`. Open **Overview → Reporting period**, select the receipt (valid for 24 hours), type `RESET`, and start the period. Receipts cannot be created by the runtime database role. Each receipt can authorize one reset. Record/check the displayed database timestamp and `reporting.reset` audit entry.
6. Verify transaction KPIs are zero before new orders, historical orders remain available and stock is unchanged. New qualifying orders count automatically. Use **Restore reporting view** to undo a reporting reset; `reporting.restore` is audited.

No live backup, reset, migration or deployment was executed in this development environment.

## Manual payment activation

The client supplied `01039010190` (`+201039010190`) for both receiving methods. The source also uses that local number as the default business WhatsApp contact. Neither live receiving-account enrollment nor the current production contact setting could be independently verified here.

Before enabling either method, the merchant must verify that the number is a valid receiving destination for that specific payment method and that the receiving identity is SOLÉA's authorized identity. In InstaPay, confirm phone-number transfer is actually supported for this recipient; do not substitute an invented handle. If another genuine identifier is required, configure the verified identifier and review customer instructions before activation.

Set the existing identifiers and enable flags in the correct Vercel environment:

| Variable | Required value after merchant verification |
| --- | --- |
| `INSTAPAY_ACCOUNT` | `01039010190` if confirmed as an InstaPay transfer destination |
| `INSTAPAY_ENABLED` | `true` |
| `INSTAPAY_RECIPIENT_VERIFIED` | `true` (new explicit verification gate) |
| `VODAFONE_CASH_NUMBER` | `01039010190` |
| `VODAFONE_CASH_ENABLED` | `true` |
| `VODAFONE_CASH_RECIPIENT_VERIFIED` | `true` (new explicit verification gate) |

Both verification flags default to false; missing verification leaves the corresponding checkout choice disabled. No secret or Paymob variable changes are required. Optional existing QR variables remain supported; no QR/financial details are invented. In admin Store Settings, verify the official WhatsApp phone is `01039010190`. WhatsApp links are built from that stored setting, not a customer-supplied recipient.

## Customer and admin workflow

- Authenticated checkout validates the existing customer profile/delivery fields and creates one idempotent provisional order with server-authoritative prices, discounts and shipping. Existing reservation logic is preserved.
- The selected method displays the receiving number, a clipboard button with fallback, and English/Arabic instructions. The provisional order page shows the exact final amount and order reference.
- The customer must upload a screenshot and submit sender phone and exact transferred amount; transfer reference is optional. Amount input never modifies the order total. No PIN, OTP or password is requested.
- JPEG, PNG and WebP (4 MB maximum, decoded/re-encoded WebP, bounded pixels) go to the existing private `payment-proofs` bucket under randomized paths. Upload and resubmission verify ownership and lock order/payment state. Replacing evidence invalidates the prior review version.
- After complete submission, the WhatsApp button prepares the requested message from owned, server-held customer/order/address/transfer data. The customer must attach the screenshot and send the message manually. `wa.me` cannot prove delivery, attach a file automatically or confirm funds. The URL contains the customer-requested message, never a tracking key or private proof URL. It should not be copied into logs or analytics.
- Admin Orders has a **Manual payments awaiting review** filter. An administrator with `payments` permission views the private proof, sender, amount comparison, reference, customer and shipping data, and opens the customer's WhatsApp conversation. The existing authenticated proof proxy remains; an authorized signed-URL endpoint also expires access after 60 seconds.
- Confirmation requires an explicit server-validated attestation that the WhatsApp message/screenshot and actual full funds received were checked. Screenshots alone are not evidence that funds settled. No customer endpoint can approve a payment. Only this admin decision makes the manual payment and order `paid` and includes it in paid revenue when within the reporting cohort.
- Rejection stores the reason and audit record. Admin may allow correction on the **same** pending order (no new inventory deduction), or close it, releasing the reservation once. Approval compares the current submission version under row locks; duplicate/stale decisions fail safely. Rejection reasons remain in immutable audit metadata even after resubmission.
- Supplied transfer references are hashed/normalized and bound uniquely per method to an order. A repeated reference cannot be applied to a different order. References are optional and customer-provided, so actual transaction duplication still requires checking the receiving ledger.
- Orders older than 24 hours with **no proof and no submission** are cancelled by maintenance, releasing stock once. Proof-bearing or submitted orders are retained for admin review. The existing Hobby cron remains once daily at 03:00 UTC; expiry is not exact to the minute and a backlog is processed in batches of 30 per run. Use the existing secured external scheduler/Pro option for larger volumes. Contact SOLÉA before transferring against an expired order; late real transfers require manual reconciliation.

## Deployment and remaining verification

Use existing Vercel/Supabase deployment instructions, with migration 011 and refreshed grants **before** promoting this application. Keep service-role credentials server-only, the proofs bucket private, and no anonymous Storage read/write policy. The backup CLI runs only on trusted operator infrastructure; Vercel still has no persistent local-storage dependency.

Still required: authenticated Vercel and Supabase access; a real production backup and restore drill; live receiving-account and business-WhatsApp verification; environment activation; migration/grants execution; baseline reset; production smoke tests and a real authorized manual transfer/WhatsApp review. Real iOS/Android apps and Safari were not exercised; browser checks use Chromium at desktop/tablet/mobile widths. No production security audit or external dashboard configuration is claimed.
