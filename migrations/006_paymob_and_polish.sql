ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK(payment_method IN ('cod','card','paymob','instapay','vodafone_cash'));

ALTER TABLE payments ADD COLUMN provider_order_id text;
ALTER TABLE payments ADD COLUMN provider_transaction_id text;
CREATE UNIQUE INDEX payments_provider_order_id_idx
  ON payments(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX payments_provider_transaction_id_idx
  ON payments(provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;

INSERT INTO content(key,title_en,title_ar,body_en,body_ar,published)
VALUES(
  'distance-selling',
  'Distance selling',
  'البيع عن بُعد',
  'Final distance-selling terms require business and legal approval before orders open.',
  'تتطلب شروط البيع عن بُعد النهائية اعتماد الشركة والمراجعة القانونية قبل إتاحة الطلبات.',
  false
)
ON CONFLICT(key) DO NOTHING;

WITH target AS (SELECT id FROM products WHERE sku='SOL-125')
UPDATE product_images pi SET
  url = CASE pi.position
    WHEN 0 THEN '/media/product-main-v2.webp'
    WHEN 1 THEN '/media/product-benefits-v2.webp'
    WHEN 2 THEN '/media/product-care-v2.webp'
    WHEN 3 THEN '/media/product-how-to-v2.webp'
    ELSE pi.url END,
  alt_en = CASE pi.position
    WHEN 0 THEN 'SOLÉA Baby Shampoo 125 mL'
    WHEN 1 THEN 'SOLÉA Baby Shampoo usage and care guide'
    WHEN 2 THEN 'SOLÉA Baby Shampoo product care guide'
    WHEN 3 THEN 'SOLÉA Baby Shampoo botanical detail guide'
    ELSE pi.alt_en END,
  alt_ar = CASE pi.position
    WHEN 0 THEN 'شامبو SOLÉA للأطفال 125 مل'
    WHEN 1 THEN 'دليل استخدام وعناية شامبو SOLÉA للأطفال'
    WHEN 2 THEN 'دليل العناية الخاص بشامبو SOLÉA للأطفال'
    WHEN 3 THEN 'دليل التفاصيل النباتية لشامبو SOLÉA للأطفال'
    ELSE pi.alt_ar END
FROM target
WHERE pi.product_id=target.id AND pi.position BETWEEN 0 AND 3;
