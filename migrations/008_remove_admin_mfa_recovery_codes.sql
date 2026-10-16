-- Apply after the TOTP-only application release has replaced all older instances.
-- Preserve enrolled authenticator secrets, replay counters, sessions and audit history.
ALTER TABLE admin_users DROP COLUMN recovery_hashes;
