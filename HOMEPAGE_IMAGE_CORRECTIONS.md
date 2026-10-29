# SOLÉA homepage image corrections — 29 October 2026

Baseline: the latest `SOLEA_storefront_content_deploy_ready.zip` (Library version 1). Its newer browser-test configuration and reporting fixture are preserved.

## Only these application changes

- `src/components/storefront.tsx`: restored the complete original hero image markup from repository commit `20a463e`, using `/media/product-main-v2.webp`, original width/height attributes (900/1000), high fetch priority, alt text and existing CSS crop/positioning. The recovered asset is byte-identical to that historical commit (SHA-256 `0013dd88d769c595e61c28c7cbc49db8c2125e0d347b350b94c2821cd7d56ea9`). No image file changed.
- `src/app/globals.css`: scoped gallery correction only. All three approved images now fill equal 4:5 frames using centered `object-fit: cover`. Background edges are cropped proportionately instead of stretching the images; bottles remain visible. Removed the middle card’s staggered vertical offset. Existing gaps, rounded corners, responsive column rules and image order are preserved.
- `tests/storefront-content-ui.test.ts`: restored-hero assertions and equal gallery width/height/aspect ratio, row alignment and spacing assertions.

No product, payment, reporting, policy, footer, database, migration, environment or security code changed. Historical `STOREFRONT_CONTENT_UPDATE.md` describes the prior release; the hero/gallery description above supersedes that release’s image presentation only.

## Verification actually completed

- Captured the homepage before and after the correction.
- Two targeted browser tests passed (0 failed), covering English and Arabic at 1440px, 768px and 390px. Verified image loading/order, equal gallery frames, aligned tops/bottoms on multi-column layouts, consistent gaps, no horizontal overflow, original hero URL/attributes and absence of browser runtime errors. Inspected rendered gallery/hero screenshots for desktop and mobile.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Compared all files with the latest deployment ZIP: only the three files listed above differ, plus this new handoff note. All image assets are unchanged.
- The full commerce/security suite was not rerun for this targeted visual correction; no claim of a new full-suite result is made.

## Apply

The complete ZIP includes the current project. The patch ZIP contains only the three changed files and this note, with paths relative to the project root. Apply it to the latest storefront deployment package, then use your existing Vercel deployment process. No database migration, seed, statistics reset or environment change is needed for this correction.

Deployment was not performed: no Vercel token or linked Vercel project is available in this workspace. The live homepage has therefore not been verified after deployment. After deployment, confirm the hero requests `/media/product-main-v2.webp` and the three gallery cards align in both languages. Local QA used Chromium with fixture API data; this is not a physical-device or live-production test.
