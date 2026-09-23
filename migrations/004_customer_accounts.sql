CREATE TABLE customer_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
  email text UNIQUE NOT NULL CHECK(length(email) <= 254),
  mobile text CHECK(mobile IS NULL OR mobile ~ '^01[0125][0-9]{8}$'),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN customer_account_id uuid REFERENCES customer_accounts(id);
ALTER TABLE sessions ADD CONSTRAINT session_identity_separation
  CHECK(num_nonnulls(admin_id, customer_account_id) <= 1);
CREATE INDEX sessions_customer_account_idx ON sessions(customer_account_id);

ALTER TABLE orders ADD COLUMN account_id uuid REFERENCES customer_accounts(id);
CREATE INDEX orders_account_created_idx ON orders(account_id,created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE TABLE saved_addresses(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '' CHECK(length(label) <= 80),
  full_name text NOT NULL CHECK(length(full_name) BETWEEN 1 AND 150),
  mobile text NOT NULL CHECK(mobile ~ '^01[0125][0-9]{8}$'),
  governorate text NOT NULL CHECK(length(governorate) BETWEEN 1 AND 150),
  city text NOT NULL CHECK(length(city) BETWEEN 1 AND 150),
  street text NOT NULL CHECK(length(street) BETWEEN 3 AND 300),
  building text NOT NULL DEFAULT '' CHECK(length(building) <= 60),
  floor text NOT NULL DEFAULT '' CHECK(length(floor) <= 30),
  apartment text NOT NULL DEFAULT '' CHECK(length(apartment) <= 30),
  notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 1000),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_addresses_account_idx ON saved_addresses(account_id,created_at);
CREATE UNIQUE INDEX saved_addresses_one_default_idx ON saved_addresses(account_id)
  WHERE is_default=true;

CREATE TABLE customer_password_resets(
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_password_resets_account_idx ON customer_password_resets(account_id);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_password_resets ENABLE ROW LEVEL SECURITY;
