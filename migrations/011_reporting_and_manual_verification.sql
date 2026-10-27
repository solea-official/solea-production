-- No data reset occurs during migration. An authorized, backed-up reset is explicit.
CREATE TABLE reporting_backups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes bigint NOT NULL CHECK(bytes>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE reporting_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid NOT NULL REFERENCES admin_identities(id),
 backup_id uuid NOT NULL UNIQUE REFERENCES reporting_backups(id)
);
CREATE TABLE reporting_state (
 id integer PRIMARY KEY CHECK(id=1), period_id uuid REFERENCES reporting_periods(id)
);
INSERT INTO reporting_state(id) VALUES(1);
ALTER TABLE reporting_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting_state ENABLE ROW LEVEL SECURITY;
CREATE INDEX orders_reporting_created_idx ON orders(created_at);

ALTER TABLE payments ADD COLUMN sender_phone text CHECK(sender_phone ~ '^01[0125][0-9]{8}$');
ALTER TABLE payments ADD COLUMN transferred_amount integer CHECK(transferred_amount>0);
ALTER TABLE payments ADD COLUMN submitted_at timestamptz;
ALTER TABLE payments ADD COLUMN submission_version integer NOT NULL DEFAULT 0 CHECK(submission_version>=0);
ALTER TABLE payments ADD COLUMN whatsapp_verified_at timestamptz;
ALTER TABLE payments ADD COLUMN correction_allowed boolean NOT NULL DEFAULT false;
-- Deduplicate supplied references per payment method without exposing them in a public API.
CREATE TABLE manual_transfer_references (
 method text NOT NULL CHECK(method IN ('instapay','vodafone_cash')),
 reference_hash text NOT NULL CHECK(reference_hash ~ '^[a-f0-9]{64}$'),
 order_id uuid NOT NULL REFERENCES orders(id), PRIMARY KEY(method,reference_hash)
);
ALTER TABLE manual_transfer_references ENABLE ROW LEVEL SECURITY;
