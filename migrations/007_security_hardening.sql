ALTER TABLE admin_users ADD COLUMN totp_ciphertext text;
ALTER TABLE admin_users ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE admin_users ADD COLUMN totp_last_counter bigint NOT NULL DEFAULT -1;
ALTER TABLE admin_users ADD COLUMN recovery_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE admin_users ALTER COLUMN mfa_required SET DEFAULT true;
UPDATE admin_users SET mfa_required=true;

ALTER TABLE sessions ADD COLUMN pending_admin_id uuid REFERENCES admin_users(id);
ALTER TABLE sessions ADD COLUMN enrollment_ciphertext text;
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions DROP CONSTRAINT session_identity_separation;
ALTER TABLE sessions ADD CONSTRAINT session_identity_separation CHECK (
  num_nonnulls(admin_id,customer_account_id,pending_admin_id)<=1
);
CREATE INDEX sessions_pending_admin_idx ON sessions(pending_admin_id) WHERE pending_admin_id IS NOT NULL;
-- Existing password-only privileged sessions must authenticate again with MFA.
UPDATE sessions SET expires_at=now() WHERE admin_id IS NOT NULL;

ALTER TABLE customer_accounts ADD COLUMN first_name text NOT NULL DEFAULT '';
ALTER TABLE customer_accounts ADD COLUMN last_name text NOT NULL DEFAULT '';
-- Do not guess how historical names should be split; customers complete these fields.
