UPDATE products
SET description_en='A thoughtful baby shampoo for a simple everyday care routine.',
    description_ar='شامبو أطفال بعناية مدروسة لروتين يومي بسيط.',
    updated_at=now()
WHERE sku='SOL-125';

UPDATE content
SET body_en='SOLÉA Baby Shampoo, presented in a 125 mL bottle.',
    body_ar='شامبو SOLÉA للأطفال في عبوة 125 مل.',
    updated_at=now()
WHERE key='faq-1';
