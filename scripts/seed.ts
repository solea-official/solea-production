import { pool, transaction } from "../src/server/db";
import { formula } from "../src/lib/formula";
import policies from "../src/lib/legal-content.json";
import approved from "../src/lib/approved-storefront-content.json";
await transaction(async (db) => {
  const cat = await db.query(
    "INSERT INTO categories(name_en,name_ar,slug) VALUES('Baby care','العناية بالأطفال','baby-care') ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id",
  );
  const p = await db.query(
    `INSERT INTO products(sku,slug,name_en,name_ar,description_en,description_ar,volume,category_id,status,inci,usage_en,usage_ar,warnings_en,warnings_ar) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13) ON CONFLICT(sku) DO NOTHING RETURNING id`,
    [
      "SOL-125",
      "baby-shampoo",
      "SOLÉA Baby Shampoo",
      "SOLÉA شامبو الأطفال",
      "A thoughtful baby shampoo for a simple everyday care routine.",
      "شامبو أطفال بعناية مدروسة لروتين يومي بسيط.",
      "125 mL",
      cat.rows[0].id,
      formula.map((x) => x[0]).join(", "),
      approved.directions.en.join("\n\n"),
      approved.directions.ar.join("\n\n"),
      "For external use only. Keep out of reach of children. Avoid direct contact with eyes. If contact occurs, rinse with plenty of water. Discontinue use if irritation occurs.",
      "للاستخدام الخارجي فقط. يُحفظ بعيدًا عن متناول الأطفال. تجنّبي ملامسة العينين مباشرة، وفي حال الملامسة تُغسل العينان بكمية وفيرة من الماء. يُوقف الاستخدام عند حدوث تهيّج.",
    ],
  );
  if (p.rowCount) {
    const id = p.rows[0].id;
    await db.query("INSERT INTO inventory(product_id) VALUES($1)", [id]);
    for (const [i, img] of [
      "product-main-v2.webp",
      "world-bath-approved.jpg",
      "product-care-v2.webp",
      "product-how-to-v2.webp",
    ].entries())
      await db.query(
        "INSERT INTO product_images(product_id,url,alt_en,alt_ar,position) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          "/media/" + img,
          [
            "SOLÉA Baby Shampoo 125 mL",
            "SOLÉA Baby Shampoo with a rubber duck, towels and bath accessories",
            "SOLÉA Baby Shampoo product care guide",
            "SOLÉA Baby Shampoo botanical detail guide",
          ][i],
          [
            "شامبو SOLÉA للأطفال 125 مل",
            "شامبو SOLÉA للأطفال مع بطة مطاطية ومناشف وأدوات الاستحمام",
            "دليل العناية الخاص بشامبو SOLÉA للأطفال",
            "دليل التفاصيل النباتية لشامبو SOLÉA للأطفال",
          ][i],
          i,
        ],
      );
  }
  const content = [
    [
      "returns",
      "Returns",
      "الإرجاع",
      "Returns are accepted only if the product has not been opened. Full return and exchange terms will be published before launch.",
      "يُقبل الإرجاع فقط إذا لم تُفتح العبوة. ستُنشر الشروط الكاملة للإرجاع والاستبدال قبل الإطلاق.",
    ],
    [
      "shipping-policy",
      "Delivery",
      "التوصيل",
      "Shipping fees, delivery times and service coverage will be confirmed before launch.",
      "ستُحدّد رسوم الشحن ومواعيد التوصيل ومناطق التغطية قبل الإطلاق.",
    ],
    ...Object.entries(policies).map(([key, p]) => [
      key,
      p.title_en,
      p.title_ar,
      p.body_en,
      p.body_ar,
    ]),
    [
      "hero",
      "Gentle care for little beginnings.",
      "عناية لطيفة لأجمل البدايات.",
      "Botanical inspiration. Thoughtful formulation. A little essential for everyday care.",
      "إلهام من النباتات وتركيبة مدروسة. بداية صغيرة للعناية اليومية.",
    ],
    [
      "about",
      "Care lives in the little things.",
      "العناية تسكن التفاصيل الصغيرة.",
      "SOLÉA brings together botanical inspiration and thoughtful formulation. We believe baby care can feel beautifully simple.",
      "تجمع SOLÉA بين الإلهام النباتي والتركيبة المدروسة. نؤمن أن العناية بالأطفال يمكن أن تكون بسيطة وجميلة.",
    ],
    [
      "faq-1",
      "What is our first product?",
      "ما أول منتجاتنا؟",
      "SOLÉA Baby Shampoo, presented in a 125 mL bottle.",
      "شامبو SOLÉA للأطفال في عبوة 125 مل.",
    ],
    [
      "faq-2",
      "When can I buy?",
      "متى يمكنني الشراء؟",
      "Price and availability will be announced when confirmed.",
      "سيُعلن السعر والتوفّر عند تأكيدهما.",
    ],
  ];
  for (const [key, en, ar, be, ba] of content)
    await db.query(
      "INSERT INTO content(key,title_en,title_ar,body_en,body_ar,published) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [key, en, ar, be, ba, !["returns", "shipping-policy"].includes(key)],
    );
});
await pool.end();
console.log(
  "Seed complete. No price, stock, shipping fee or administrator password was invented.",
);
