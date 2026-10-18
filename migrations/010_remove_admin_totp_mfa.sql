-- Run after 009. Preserve identities, credentials, authorized sessions and history.
-- Revoke incomplete login/enrollment attempts; never promote them to admin sessions.
UPDATE sessions SET expires_at=now() WHERE pending_admin_id IS NOT NULL;

-- Replace the credential-cleanup trigger before removing its obsolete columns.
CREATE OR REPLACE FUNCTION preserve_admin_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_identities(id,email,role_id)
      VALUES(NEW.id,NEW.email,NEW.role_id);
    RETURN NEW;
  END IF;
  UPDATE public.admin_identities
    SET email=OLD.email,role_id=OLD.role_id,deleted_at=now() WHERE id=OLD.id;
  UPDATE public.sessions SET expires_at=now(),admin_id=NULL WHERE admin_id=OLD.id;
  DELETE FROM public.password_resets WHERE admin_id=OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION preserve_admin_identity() FROM PUBLIC;

ALTER TABLE sessions DROP CONSTRAINT session_identity_separation;
ALTER TABLE sessions DROP COLUMN pending_admin_id;
ALTER TABLE sessions DROP COLUMN enrollment_ciphertext;
ALTER TABLE sessions DROP COLUMN mfa_verified_at;
ALTER TABLE sessions ADD CONSTRAINT session_identity_separation CHECK (
  num_nonnulls(admin_id,customer_account_id)<=1
);
ALTER TABLE admin_users DROP COLUMN totp_ciphertext;
ALTER TABLE admin_users DROP COLUMN totp_enabled;
ALTER TABLE admin_users DROP COLUMN totp_last_counter;
ALTER TABLE admin_users DROP COLUMN mfa_required;
