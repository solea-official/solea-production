# SOLÉA targeted storefront update — 29 October 2026

## Implemented

- Privacy, Terms and Distance Selling: complete English and Arabic copy, semantic section headings, RTL/LTR, existing policy navigation and support links. Payment-method availability is rendered from effective server configuration, not claimed unconditionally.
- Footer: only Company, Customer Care, Social Media, Contact and Legal headings changed to bold `h4`. Existing sections and Secure Payments preserved. Social links appear Instagram → Facebook → TikTok → WhatsApp with accessible icons and safe external-link attributes.
- Two-bottle offer: qualifying `SOL-125` / `baby-shampoo` pairs cost **EGP 449.99**, calculated in integer minor units. The product action selects/adds two bottles; the cart and checkout recalculate automatically as quantities change. Each complete pair qualifies; an extra single bottle retains its database price. The better of the bundle discount or a valid coupon applies once, without stacking; a losing coupon is not consumed. Existing coupon validity checks remain. The order records original unit prices, the discount and the final payable amount. Existing inventory reservation and payment handling are unchanged.
- The single-bottle price is never updated. At EGP 249.99, two singles total EGP 499.98; the resulting bundle discount is EGP 49.99. The unsupported EGP 499.99 reference price is not displayed as a comparison.
- Manual payments: the exact supplied six-step English/Arabic instructions now appear at checkout and on the provisional-order payment panel. The prominent action reads “Send Payment Proof via WhatsApp” / “إرسال إثبات التحويل عبر واتساب”. Returning to a submitted order loads its authorized WhatsApp link. The existing server composes the message from the owned order, customer, sender, amount and reference. Private screenshot upload and administrative verification remain mandatory. Opening WhatsApp never changes payment status or creates an order.
- Hero: original `/media/product-main-v2.webp` retained byte-for-byte; `object-fit: contain`, centered positioning and responsive internal padding reduce the zoom. Existing blue background, layout, caption and text remain. The three gallery assets and their order/layout are unchanged.

## Files changed

Production files:
- `src/app/globals.css`
- `src/components/provider.tsx`
- `src/components/social-links.tsx`
- `src/components/storefront.tsx`
- `src/components/checkout.tsx`
- `src/components/manual-payment.tsx`
- `src/components/distance-selling.tsx`
- `src/server/commerce.ts`
- `src/lib/types.ts`
- `scripts/seed.ts`

Added:
- `src/lib/promotions.ts` — shared integer promotion rule, recalculated from database rows by the server.
- `src/lib/legal-content.json` — complete bilingual policy source used by fresh-install seed and checked against the migration.
- `src/components/manual-payment-steps.tsx` — centralized exact approved payment instructions.
- `migrations/013_complete_customer_policies.sql` — publishes only the three requested policies.
- `tests/bundle-policies.test.ts` — pricing, quantity, coupon, stock, tampering, idempotency and migration scope regressions.
- `FINAL_STOREFRONT_UPDATE.md` — this handoff.

Updated tests:
- `tests/storefront-content-ui.test.ts` — four social links, five bold headings, contain hero, bundle-to-cart interaction and complete bilingual policies.
- `tests/manual-payment-ui.test.ts` — exact new button, six steps and Arabic instructions.
- `tests/reporting-manual-upgrade.test.ts`, `tests/security.test.ts`, `tests/vercel-supabase-manual.test.ts` — fixture content inserts now upsert, because migration 013 legitimately creates the requested policy records. Security assertions were not removed.

## Database and deployment

No production database connection or Vercel deployment credentials were available in this workspace. **Nothing was deployed, no production migration was executed, and no reporting reset was performed.** Live payment activation and post-deployment behavior have not been independently verified.

For the existing deployment already through migration 012:
1. Back up the current database/content records using the existing trusted backup procedure. Review missing seller disclosures below with the owner.
2. Install with `npm ci`; keep all current environment values, including Paymob and restricted runtime `DATABASE_URL`.
3. In trusted migration CI/workstation, run `npm run db:migrate` using the existing migration-owner `DIRECT_DATABASE_URL`. The runner applies only pending migration **013 after 012**. Do not run `db:seed` on production.
4. Promote the tested application release to the existing Vercel project immediately after migration. Migration 013 is schema-compatible with the preceding application; it changes only the three requested content rows. No new grants, tables, environment variables or credentials are required.
5. Verify the three policies in both languages, footer, product/cart/quote totals, hero, and configured manual methods. Use a controlled test order for payment verification, not a real customer order. Preserve Paymob callback settings and the existing reporting baseline.

Migration 013 does not touch Returns, Shipping, products, prices, stock, orders, customers, payments, permissions or reporting settings. Rollback: redeploy the previous immutable application and restore only the three policy rows from the approved backup via a reviewed corrective migration if required. Never delete migration history or undo completed orders. Already-created orders keep their stored totals after a code rollback.

Manual receiving details remain configuration-driven. The existing example values are `INSTAPAY_ACCOUNT=01039010190` and `VODAFONE_CASH_NUMBER=01039010190`; production must retain the verified receiving details, enabled flags and existing `*_RECIPIENT_VERIFIED` safeguards. The official support/social WhatsApp URL is `https://wa.me/201039010190`. No activation safeguards were bypassed.

## Verification actually performed

- `npm run test`: **107 passed, 0 failed, 0 skipped**, including existing Paymob callback/amount/idempotency tests, customer ownership, admin authorization/deletion, reporting, uploads and manual payment approval tests.
- New database/service tests: **8 passed**. Covers quantities 1/2/3/4, unrelated products, no price increase, shipping on discounted subtotal, better coupon without stacking, COD/InstaPay/Vodafone orders, persisted discount and unit prices, one stock deduction under retry, forged totals rejection, insufficient stock, and content-only migration scope.
- Browser tests cover English/Arabic, 390/768/1440-pixel layouts, exact usage content retained, unchanged gallery references, no horizontal overflow, social attributes, bundle selection/cart adjustment, proof upload and pending verification. Browser API transports are fixtures; server tests separately exercise the real API/services with isolated PostgreSQL-compatible PGlite and storage/provider adapters.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed (Next.js production webpack build).
- `npm run security:scan`: 119 files checked, no findings.
- `git diff --check`: passed.
- Focused browser rerun after restoring the sandbox browser runtime: **4 passed, 0 failed**.
- Visual inspection: existing hero asset is fully visible with breathing room on mobile and desktop; footer icons align in RTL; targeted policy and product layouts reviewed from rendered browser captures.

The sandbox needed local Chromium extraction without archive ownership restoration; an optional screenshot rerun initially failed during browser setup, not application execution. The focused rerun passed after correcting that local browser setup; no application changes were needed. No live Paymob transaction, live Supabase operation, external social-account login or production deployment was performed in this phase.

## Legal sources and unresolved disclosures

The page copy was prepared against the actual application and the following references, reviewed 29 October 2026:
- Egyptian Consumer Protection Law 181/2018, including Articles 17 and 37–41: https://www.wipo.int/wipolex/en/legislation/details/19866
- Arabic law text: https://alhasswalawfirm.com/law-library/law-181-2018
- Executive Decision 822/2019: https://www.laweg.net/framePlain.aspx?NID=140476&action=viewactivepages&itemid=113646&type=6
- Consumer Protection Agency guidance on returns and replacement: https://cpa.gov.eg/ar-eg/بيانات-اعلامية/ArtMID/654/ArticleID/6790
- Personal Data Protection Center consent guidance referring to Law 151/2020 and Decision 816/2025: https://pdpc.gov.eg/assets/pdf-data/Guidelines/DSConsent.pdf
- Executive Regulations 816/2025 Arabic text: https://alhasswalawfirm.com/law-library/decree-816-2025

**Owner information still needed:** verified legal seller/controller identity, registered business address, commercial registration and tax details, and applicable manufacturer/importer identification. A business email or dedicated privacy/DPO contact should be supplied if applicable; none was invented. The operator must verify retention obligations, provider processing locations, required data-protection registrations/licenses and cross-border transfer permissions. Repository inspection cannot establish these operational/legal facts or full legal compliance.

**Existing contradiction intentionally left unchanged:** Returns seed/fallback text and the product delivery/returns summary state that returns are accepted only if unopened. That blanket wording needs owner/legal review against mandatory defective/nonconforming-goods rights. The new requested policies expressly preserve statutory rights; existing Returns and Shipping pages were not changed.

**Operational disclosure gap:** verify that the actual seller identification and a durable electronic transaction notice satisfy distance-contract disclosure requirements. Account order details already provide a reference and actual status, and transactional email remains optional; no new email-delivery guarantee was invented.

The policies are complete content, not a claim that missing company disclosures, operational legal requirements or the separate final production security audit have been completed.
