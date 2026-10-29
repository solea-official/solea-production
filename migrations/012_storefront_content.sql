-- Content-only update. No price, stock, order, payment or reporting changes.
-- Run once after migration 011 through the existing migration runner.
UPDATE products SET usage_en='DIRECTIONS FOR USE – SOLEA BABY

Apply an appropriate amount of Solea Baby Shampoo to wet hair. Gently massage into the scalp until a soft lather forms, then rinse thoroughly with water.

NO TEARS FORMULA

Designed to gently cleanse your baby’s hair and delicate scalp.',usage_ar='طريقة الاستخدام – SOLEA BABY

يُوضع مقدار مناسب من شامبو Solea Baby على الشعر المبلل، ويُدلّك بلطف على فروة الرأس حتى تتكوّن رغوة ناعمة، ثم يُشطف جيدًا بالماء.

تركيبة لا تسبب الدموع

صُمّم لتنظيف شعر طفلك وفروة رأسه الحساسة بلطف.',updated_at=now() WHERE sku='SOL-125';
-- This known legacy marketing image contains superseded directions; preserve custom media.
UPDATE product_images SET url='/media/world-bath-approved.jpg',alt_en='SOLÉA Baby Shampoo with a rubber duck, towels and bath accessories',alt_ar='شامبو SOLÉA للأطفال مع بطة مطاطية ومناشف وأدوات الاستحمام'
WHERE product_id IN (SELECT id FROM products WHERE sku='SOL-125') AND url='/media/product-benefits-v2.webp';
INSERT INTO content(key,title_en,title_ar,body_en,body_ar,published) VALUES('distance-selling','Distance selling','البيع عن بُعد','1. Orders and confirmation

Submit your order through checkout with accurate customer and delivery details. An order reference records your request and lets you follow its status; it does not by itself prove payment or acceptance for fulfilment. For a manual transfer, the order remains provisional until an authorized SOLÉA administrator verifies the money received. Uploading proof or opening WhatsApp does not confirm payment. Online payment status comes from the verified payment-provider notification. Cash on Delivery remains unpaid until collection. Check your account or contact SOLÉA for the current order status.

2. Prices and payments

Review the product prices, any applicable discount, delivery fee and final total shown at checkout before submitting your request. Only payment methods currently enabled and displayed at checkout are available. For manual transfers, follow the displayed receiving details, upload the payment screenshot and transfer information, and send the prepared WhatsApp message with the screenshot attached manually. Never share a PIN, banking password or one-time verification code.

3. Delivery and shipping

Delivery availability and fees depend on the selected area and the current checkout configuration. Refer to the Shipping Policy and contact SOLÉA for the delivery estimate applicable to your order. No fixed delivery time or guaranteed arrival date is promised by this page. Any agreed delivery date and your statutory rights in the event of delay remain applicable.

4. Cancellation and order changes

To request cancellation or correct an order, contact SOLÉA by phone or WhatsApp and provide the order reference. SOLÉA will explain the order’s current fulfilment status and the applicable next steps. A request is not automatically completed by opening a WhatsApp conversation. Statutory cancellation and withdrawal rights remain unaffected; no additional store cancellation deadline or charge is introduced here.

5. Returns and refunds

Where the statutory right applies, a distance-sale purchase may be withdrawn within 14 days of receiving the goods, subject to the exceptions specified by Egyptian law. Defective goods have separate statutory replacement or refund protections, including the 30-day period described by the Consumer Protection Agency.

SOLÉA’s stated unopened-product condition for ordinary returns does not remove mandatory rights concerning defective, damaged or incorrect goods. Contact support to arrange the appropriate remedy. Applicable legal requirements govern refund timing, payment method and return costs; no extra fee, deduction or shorter deadline is created by this draft. The published Returns Policy must be read consistently with these rights.

6. Damaged, defective or incorrect products

Contact SOLÉA by phone or WhatsApp with the order reference and a description of the issue. Photos of the product and packaging can help the review, but a photo requirement does not replace or restrict statutory rights. Do not use a product that appears damaged or unsafe. Support will explain the inspection and return or replacement steps appropriate to the case.

7. Customer information

Provide accurate contact and shipping details and notify SOLÉA of corrections. Personal information is handled as described in the Privacy Policy. Send only information needed to identify the order and resolve your request; do not send financial credentials or unrelated identity documents.

8. Customer support

Use the current official phone and WhatsApp links shown below or on the Contact page. Include your order reference when asking about an existing order. No support hours or additional contact address are promised in this draft. Nothing in these terms limits mandatory Egyptian consumer rights.','1. الطلبات وتأكيدها

قدّم طلبك من خلال صفحة إتمام الشراء مع إدخال بيانات العميل والتوصيل بدقة. رقم الطلب يثبت تسجيل طلبك ويساعدك على متابعة حالته، ولا يُعدّ وحده إثباتًا للدفع أو قبولًا لتنفيذ الطلب. عند التحويل اليدوي، يظل الطلب مبدئيًا إلى أن يتحقق مسؤول مخوّل في SOLÉA من استلام المبلغ. رفع الإيصال أو فتح واتساب لا يؤكد الدفع. تُحدَّث حالة الدفع الإلكتروني بناءً على إشعار موثّق من مزوّد الدفع. ويظل الدفع عند الاستلام غير مدفوع حتى تحصيله. راجع حسابك أو تواصل مع SOLÉA لمعرفة حالة الطلب الحالية.

2. الأسعار وطرق الدفع

راجع أسعار المنتجات وأي خصم سارٍ ورسوم التوصيل والإجمالي النهائي المعروض عند إتمام الشراء قبل إرسال طلبك. تتاح فقط طرق الدفع المفعّلة والمعروضة في صفحة إتمام الشراء. للتحويل اليدوي، اتبع بيانات الاستلام المعروضة، وارفع صورة تأكيد الدفع وبيانات التحويل، ثم أرسل رسالة واتساب المُعدّة مع إرفاق الصورة بنفسك. لا تشارك رقمًا سريًا أو كلمة مرور بنكية أو رمز تحقق لمرة واحدة.

3. التوصيل والشحن

تتحدد إمكانية التوصيل ورسومه وفقًا للمنطقة المختارة وإعدادات الشراء الحالية. راجع سياسة الشحن وتواصل مع SOLÉA لمعرفة المدة التقديرية المناسبة لطلبك. لا تتضمن هذه الصفحة وعدًا بمدة توصيل ثابتة أو موعد وصول مضمون. ويظل أي موعد تسليم متفق عليه وحقوقك القانونية عند التأخير واجبة المراعاة.

4. الإلغاء وتعديل الطلب

لطلب الإلغاء أو تصحيح بيانات الطلب، تواصل مع SOLÉA هاتفيًا أو عبر واتساب مع ذكر رقم الطلب. ستوضح SOLÉA حالة تنفيذ الطلب والخطوات المناسبة. لا يُنفّذ الطلب تلقائيًا بمجرد فتح محادثة واتساب. تظل حقوق الإلغاء والعدول المقررة قانونًا محفوظة؛ ولا تضيف هذه المسودة مهلة إلغاء خاصة بالمتجر أو رسومًا جديدة.

5. الإرجاع واسترداد المبالغ

عندما ينطبق الحق القانوني، يجوز العدول عن شراء تم عن بُعد خلال 14 يومًا من استلام السلعة، مع مراعاة الاستثناءات التي يقررها القانون المصري. وللسلع المعيبة حقوق مستقلة في الاستبدال أو استرداد القيمة، تشمل مدة الثلاثين يومًا التي يوضحها جهاز حماية المستهلك.

شرط SOLÉA المعلن بعدم فتح المنتج في حالات الإرجاع العادية لا يلغي الحقوق الإلزامية المتعلقة بالسلع المعيبة أو التالفة أو غير المطابقة للطلب. تواصل مع الدعم لترتيب المعالجة المناسبة. تخضع مدة رد المبلغ وطريقة رده وتكاليف الإرجاع للقواعد القانونية الواجبة التطبيق؛ ولا تفرض هذه المسودة رسومًا أو خصومات إضافية أو مهلة أقصر. وتُقرأ سياسة الإرجاع المنشورة بما يتفق مع هذه الحقوق.

6. المنتجات التالفة أو المعيبة أو غير المطابقة للطلب

تواصل مع SOLÉA هاتفيًا أو عبر واتساب مع ذكر رقم الطلب ووصف المشكلة. قد تساعد صور المنتج والتغليف في المراجعة، لكن طلب الصور لا يحل محل الحقوق القانونية ولا يقيّدها. لا تستخدم منتجًا يبدو تالفًا أو غير آمن. سيوضح الدعم خطوات الفحص والإرجاع أو الاستبدال المناسبة للحالة.

7. بيانات العميل

أدخل بيانات التواصل والشحن بدقة وأبلغ SOLÉA بأي تصحيح مطلوب. تُعالج البيانات الشخصية وفقًا لسياسة الخصوصية. أرسل فقط المعلومات اللازمة لتحديد الطلب وحل المشكلة، ولا ترسل بيانات دخول مالية أو مستندات هوية لا ترتبط بطلبك.

8. دعم العملاء

استخدم روابط الهاتف وواتساب الرسمية الحالية الموضحة أدناه أو في صفحة التواصل. اذكر رقم الطلب عند الاستفسار عن طلب قائم. لا تتضمن هذه المسودة وعدًا بساعات دعم أو عنوان تواصل إضافي. ولا يحد أي بند فيها من حقوق المستهلك الإلزامية المقررة في القانون المصري.',false)
ON CONFLICT(key) DO UPDATE SET body_en=EXCLUDED.body_en,body_ar=EXCLUDED.body_ar,updated_at=now()
WHERE NOT content.published AND content.body_en IN ('Final distance-selling terms require business and legal approval before orders open.','Full terms will be published before orders open.','');
