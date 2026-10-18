-- Historical identities contain no credentials. Keep audit/payment references intact
-- while allowing the corresponding authentication account to be permanently removed.
CREATE TABLE admin_identities (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  role_id text NOT NULL,
  deleted_at timestamptz
);
INSERT INTO admin_identities(id,email,role_id)
SELECT id,email,role_id FROM admin_users;
ALTER TABLE admin_identities ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey
  FOREIGN KEY(actor_id) REFERENCES admin_identities(id);
ALTER TABLE payments DROP CONSTRAINT payments_verified_by_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_verified_by_fkey
  FOREIGN KEY(verified_by) REFERENCES admin_identities(id);

-- The runtime cannot edit historical identities directly. This fixed trigger is
-- owned by the migration role; it accepts no caller-controlled SQL or object paths.
CREATE FUNCTION preserve_admin_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_identities(id,email,role_id)
      VALUES(NEW.id,NEW.email,NEW.role_id);
    RETURN NEW;
  END IF;
  UPDATE public.admin_identities
    SET email=OLD.email,role_id=OLD.role_id,deleted_at=now() WHERE id=OLD.id;
  -- Retain session rows referenced by historical carts/orders, but revoke all
  -- credentials and clear pending enrollment data before removing the account.
  UPDATE public.sessions SET expires_at=now(),admin_id=NULL,pending_admin_id=NULL,
    enrollment_ciphertext=NULL,mfa_verified_at=NULL
    WHERE admin_id=OLD.id OR pending_admin_id=OLD.id;
  DELETE FROM public.password_resets WHERE admin_id=OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION preserve_admin_identity() FROM PUBLIC;
CREATE TRIGGER admin_identity_created AFTER INSERT ON admin_users
  FOR EACH ROW EXECUTE FUNCTION preserve_admin_identity();
CREATE TRIGGER admin_identity_deleted BEFORE DELETE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION preserve_admin_identity();
