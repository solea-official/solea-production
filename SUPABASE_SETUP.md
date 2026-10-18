# Supabase setup

1. Create a Supabase project and keep its database password and keys in the selected secret manager.
2. Create a dedicated server-only login role named `solea_app`. Set `DATABASE_URL` to its PostgreSQL transaction-pooler connection string with TLS enabled and `DB_POOL_MAX=1`; never expose this connection string to the browser.
3. Set `DIRECT_DATABASE_URL` to the database-owner direct or session-pooler connection string only in trusted migration CI, not Vercel runtime. Run migrations in numeric order through `010_remove_admin_totp_mfa.sql`, then run `npm run db:grants` as the owner. For existing installations, follow the coordinated migration-010 upgrade in `SETUP.md`; migration 010 removes only obsolete administrator MFA state and preserves business/customer history. Use the restricted `solea_app` transaction-pooler URL as runtime `DATABASE_URL`.
4. Create a public Storage bucket named by `SUPABASE_STORAGE_BUCKET` (default `product-images`) for sanitized product WebP files. Do not add anonymous upload/update/delete policies.
5. Create a private Storage bucket named by `SUPABASE_PAYMENT_PROOFS_BUCKET` (default `payment-proofs`). Do not create public read policies for payment proofs.
6. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in server environments. `SUPABASE_ANON_KEY` is reserved for future public-safe Supabase use and is not required by the current browser bundle.
7. Verify `/api/health`, create/replace/delete a product image as an authorized admin, and confirm another customer cannot read a payment proof.

The application performs Storage operations only through authenticated server routes. The service-role key must never use a `NEXT_PUBLIC_` name.
