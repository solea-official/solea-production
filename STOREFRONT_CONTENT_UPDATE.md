# SOLÉA storefront content update

29 October 2026 — continued from the delivered reporting/manual-payment baseline, local checkpoint `20a463e`.

## Implemented

- Replaced the three “From our world.” cards in the requested order. The hero also uses the new botanical image, preserving its layout and caption.
- Original JPEG bytes are retained; no editing, generation, label changes or screenshot substitutes. Next Image generates responsive formats, reserves image space and lazy-loads gallery images. `object-fit: contain` keeps the whole artwork visible; different source proportions can leave a small cream margin within the existing frames.
- Instagram remains bound to the existing store-setting URL. Added TikTok `https://www.tiktok.com/@soleababy.egypt` in the same footer social area. Both have brand icons, bilingual accessible labels, descriptive titles, `target="_blank"` and `rel="noopener noreferrer"`.
- Exact approved English and Arabic directions, including headings and NO TEARS text, live in `src/lib/approved-storefront-content.json` for seed/release consistency. The product detail accordion reads the existing editable database fields with semantic headings and locale direction. Admin product editing continues to use those same fields.
- The known legacy product marketing image `/media/product-benefits-v2.webp` contains superseded directions. Only its SOL-125 database reference is replaced with the supplied bath image; custom image URLs, other gallery positions and other products are preserved. The old asset file remains for historical compatibility.
- Added the complete bilingual Distance Selling draft to the existing CMS key and route. It stays unpublished pending business/legal approval. Existing published terms and owner-written drafts are not overwritten. Active payment methods and official support links are rendered from current settings.

## Image mapping

| Position | Uploaded original | Production asset | Dimensions |
| --- | --- | --- | --- |
| Gallery 1 and hero | WhatsApp Image 2026-10-28 at 3.21.59 AM (2).jpeg | public/media/world-botanical-approved.jpg | 1254 × 1254 |
| Gallery 2; replacement for the known outdated directions image | WhatsApp Image 2026-10-28 at 3.21.59 AM.jpeg | public/media/world-bath-approved.jpg | 1145 × 1374 |
| Gallery 3 | WhatsApp Image 2026-10-28 at 3.21.59 AM (1).jpeg | public/media/world-benefits-approved.jpg | 1145 × 1374 |

Each destination SHA-256 matches its uploaded original. The attachment screenshot is not used as an asset.

## Database and deployment

New migration: `012_storefront_content.sql`, after 001–011. No schema/grant changes, no new environment variables, and no edits to previous migrations.

1. Back up affected product usage/image rows and the `distance-selling` content row with your existing secure database backup process.
2. Install with `npm ci`, run checks, and deploy the code/assets to the existing Vercel project. The renderer accepts both old plain text and the new structured directions, so it is compatible before migration.
3. From the existing trusted migration environment with migration-only credentials, run `npm run db:migrate`. The migration ledger skips already-applied files. This update needs only 012 on a current 001–011 database. Deploy assets before running 012 so its new image URL already exists.
4. Do not run a reporting reset or production seed. Do not rerun old migrations manually. No changes to `scripts/grants.ts`, runtime privileges, payment flags or security headers are required.
5. Verify both languages on Home and the SOL-125 product, all three optimized image URLs, footer links and `/distance-selling` on the production domain. Approve and publish Distance Selling separately through Content management after reviewing `DISTANCE_SELLING_PROPOSAL.md`.

Rollback: restore the backed-up content/image rows and previous deployment together. Avoid removing new image assets while database records still reference them. Historical order/payment/reporting records are unaffected.

## Validation results

- `npm run test`: **97 passed, 0 failed**. Includes existing Paymob/HMAC/idempotency, COD/manual transfer, private proofs, WhatsApp verification, reporting baseline, admin authentication/deletion/RBAC and customer ownership regressions.
- Four new tests cover exact EN/AR usage, asset metadata/order, content migration safety, rendered bilingual gallery/footer/directions and published/unpublished legal behavior.
- Browser QA: Chromium, 1440/768/390 pixel widths, English and Arabic. Checked image loading, responsive markup, full-image fit, bounds/overflow, headings, link attributes, RTL and runtime page errors. Actual screenshots reviewed. Additional strengthened bounds checks passed in a targeted rerun (2/2).
- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm run security:scan`: passed, no findings. `git diff --check`: passed.
- Built Next.js server: all three `/_next/image` requests returned HTTP 200 and WebP at 640px, preserving 1:1 and 5:6 ratios.
- Source JPEG hashes verified byte-for-byte against attachments.

Browser fixtures use real storefront components and Next Image with mocked account/catalog API data; integration tests use isolated local PostgreSQL-compatible test databases. The standalone esbuild harness now mirrors Next's Image import/environment handling; no application environment secrets are supplied to that harness. This is not a real-device iOS/Android test, live payment transaction, external social-account ownership verification or production smoke test.

## Unchanged / operational limits

No reporting reset, stock/price changes, customer/order/payment edits, authentication changes or Paymob changes were made. No production database, Vercel deployment credentials or live configuration were available, so migration 012 and deployment were **not** executed against production. No claim is made that production assets/settings were verified.

If manual methods are hidden in production, inspect (do not bypass) the existing gates:

- InstaPay: `INSTAPAY_ENABLED=true`, `INSTAPAY_RECIPIENT_VERIFIED=true`, and the confirmed nonempty `INSTAPAY_ACCOUNT`.
- Vodafone Cash: `VODAFONE_CASH_ENABLED=true`, `VODAFONE_CASH_RECIPIENT_VERIFIED=true`, and the confirmed nonempty `VODAFONE_CASH_NUMBER`.
- Existing store/checkout readiness settings still apply. QR configuration remains optional. Confirm receiver activation with the merchant before setting verification flags. This task did not change those values or establish whether production currently has them enabled.

The proposed terms require owner/legal approval, accurate seller disclosures and reconciliation with the existing Returns Policy before publication. See the separate complete bilingual proposal and official legal-source references.

## Files modified or added

- `DISTANCE_SELLING_PROPOSAL.md`
- `STOREFRONT_CONTENT_UPDATE.md`
- `migrations/012_storefront_content.sql`
- `public/media/world-bath-approved.jpg`
- `public/media/world-benefits-approved.jpg`
- `public/media/world-botanical-approved.jpg`
- `scripts/seed.ts`
- `scripts/ui-check.ts`
- `src/app/globals.css`
- `src/components/distance-selling.tsx`
- `src/components/product-usage.tsx`
- `src/components/provider.tsx`
- `src/components/social-links.tsx`
- `src/components/storefront.tsx`
- `src/lib/approved-storefront-content.json`
- `src/lib/home-media.ts`
- `tests/admin-deletion-ui.test.ts`
- `tests/browser/image.tsx`
- `tests/manual-payment-ui.test.ts`
- `tests/storefront-content-ui.test.ts`
- `tests/storefront-content.test.ts`
- `tests/story-mfa-ui.test.ts`
