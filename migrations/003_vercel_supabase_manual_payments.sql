UPDATE roles
SET permissions = array_append(permissions, 'payments')
WHERE id IN ('owner','manager') AND NOT ('payments' = ANY(permissions));

ALTER TABLE product_images ADD COLUMN storage_path text;
CREATE UNIQUE INDEX product_images_storage_path_idx ON product_images(storage_path) WHERE storage_path IS NOT NULL;

ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK(payment_method IN ('cod','card','instapay','vodafone_cash'));

ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK(status IN ('pending','cod_pending','awaiting_confirmation','paid','failed','rejected','cancelled','refunded'));
ALTER TABLE payments ADD COLUMN transfer_reference text CHECK(length(transfer_reference) <= 120);
ALTER TABLE payments ADD COLUMN proof_storage_path text;
ALTER TABLE payments ADD COLUMN verified_by uuid REFERENCES admin_users(id);
ALTER TABLE payments ADD COLUMN verified_at timestamptz;
ALTER TABLE payments ADD COLUMN rejection_reason text CHECK(length(rejection_reason) <= 500);
CREATE UNIQUE INDEX payments_proof_storage_path_idx ON payments(proof_storage_path) WHERE proof_storage_path IS NOT NULL;

ALTER TABLE store_settings ADD COLUMN shipping_zones jsonb NOT NULL DEFAULT '[]';
ALTER TABLE store_settings ADD COLUMN free_shipping_threshold integer CHECK(free_shipping_threshold IS NULL OR free_shipping_threshold > 0);
UPDATE store_settings s
SET shipping_zones = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'governorate', r->>'governorate',
    'zone', '',
    'fee', (r->>'fee')::integer,
    'active', true
  ))
  FROM jsonb_array_elements(s.shipping_rates) r
), '[]'::jsonb)
WHERE shipping_zones = '[]'::jsonb AND jsonb_array_length(shipping_rates) > 0;

-- The application uses a server-only PostgreSQL connection. No table is exposed
-- directly to Supabase anon/authenticated Data API roles.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
