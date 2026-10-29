import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { db, engine } from "./helpers";
import approved from "../src/lib/approved-storefront-content.json";
import { homeMedia } from "../src/lib/home-media";
const { content, products } = await import("../src/server/catalog");
after(() => engine.close());

test("approved usage is exact in both languages and image metadata matches real production files", async () => {
  assert.deepEqual(approved.directions.en, [
    "DIRECTIONS FOR USE – SOLEA BABY",
    "Apply an appropriate amount of Solea Baby Shampoo to wet hair. Gently massage into the scalp until a soft lather forms, then rinse thoroughly with water.",
    "NO TEARS FORMULA",
    "Designed to gently cleanse your baby’s hair and delicate scalp.",
  ]);
  assert.deepEqual(approved.directions.ar, [
    "طريقة الاستخدام – SOLEA BABY",
    "يُوضع مقدار مناسب من شامبو Solea Baby على الشعر المبلل، ويُدلّك بلطف على فروة الرأس حتى تتكوّن رغوة ناعمة، ثم يُشطف جيدًا بالماء.",
    "تركيبة لا تسبب الدموع",
    "صُمّم لتنظيف شعر طفلك وفروة رأسه الحساسة بلطف.",
  ]);
  assert.deepEqual(
    homeMedia.map((x) => x.src),
    [
      "/media/world-botanical-approved.jpg",
      "/media/world-bath-approved.jpg",
      "/media/world-benefits-approved.jpg",
    ],
  );
  for (const img of homeMedia) {
    const m = await sharp(await readFile("public" + img.src)).metadata();
    assert.equal(m.width, img.width);
    assert.equal(m.height, img.height);
    assert.equal(m.format, "jpeg");
  }
});

test("content migration updates only SOL-125 usage/known old instructions image and preserves approved policies, prices, stock and custom images", async () => {
  const target = (
    await db.query(
      "INSERT INTO products(sku,slug,name_en,name_ar,description_en,description_ar,volume,price) VALUES('SOL-125','baby-shampoo','Baby','طفل','','','125 mL',12345) RETURNING id",
    )
  ).rows[0].id;
  const other = (
    await db.query(
      "INSERT INTO products(sku,slug,name_en,name_ar,description_en,description_ar,volume,usage_en) VALUES('OTHER','other','Other','آخر','','','125 mL','Keep this') RETURNING id",
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO inventory(product_id,stock) VALUES($1,17),($2,23)",
    [target, other],
  );
  await db.query(
    "INSERT INTO product_images(product_id,url,alt_en,alt_ar,position) VALUES($1,'/media/product-benefits-v2.webp','','',1),($1,'/media/custom.jpg','','',2),($2,'/media/product-benefits-v2.webp','','',1)",
    [target, other],
  );
  await db.query(
    "UPDATE content SET body_en='Approved existing terms',published=true WHERE key='distance-selling'",
  );
  const migration = await readFile(
    "migrations/012_storefront_content.sql",
    "utf8",
  );
  await engine.exec(migration);
  const p = (await db.query("SELECT * FROM products WHERE id=$1", [target]))
    .rows[0];
  assert.equal(p.usage_en, approved.directions.en.join("\n\n"));
  assert.equal(p.usage_ar, approved.directions.ar.join("\n\n"));
  assert.equal(p.price, 12345);
  assert.equal(
    (
      await db.query("SELECT stock FROM inventory WHERE product_id=$1", [
        target,
      ])
    ).rows[0].stock,
    17,
  );
  assert.equal(
    (await db.query("SELECT usage_en FROM products WHERE id=$1", [other]))
      .rows[0].usage_en,
    "Keep this",
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT url FROM product_images WHERE product_id=$1 ORDER BY position",
        [target],
      )
    ).rows.map((x) => x.url),
    ["/media/world-bath-approved.jpg", "/media/custom.jpg"],
  );
  assert.equal(
    (
      await db.query("SELECT url FROM product_images WHERE product_id=$1", [
        other,
      ])
    ).rows[0].url,
    "/media/product-benefits-v2.webp",
  );
  assert.equal(
    (await db.query("SELECT body_en FROM content WHERE key='distance-selling'"))
      .rows[0].body_en,
    "Approved existing terms",
  );
  await db.query(
    "UPDATE content SET body_en='Owner custom draft',published=false WHERE key='distance-selling'",
  );
  await engine.exec(migration);
  assert.equal(
    (await db.query("SELECT body_en FROM content WHERE key='distance-selling'"))
      .rows[0].body_en,
    "Owner custom draft",
  );
  await db.query(
    "UPDATE content SET body_en='Final distance-selling terms require business and legal approval before orders open.' WHERE key='distance-selling'",
  );
  await engine.exec(migration);
  const draft = (
    await db.query("SELECT * FROM content WHERE key='distance-selling'")
  ).rows[0];
  assert.equal(draft.published, false);
  assert.equal(
    draft.body_en,
    approved.distanceSelling.en.map((s) => s.join("\n\n")).join("\n\n"),
  );
  assert.equal(
    draft.body_ar,
    approved.distanceSelling.ar.map((s) => s.join("\n\n")).join("\n\n"),
  );
  const publicDraft = (await content()).find(
    (x) => x.key === "distance-selling",
  );
  assert.doesNotMatch(publicDraft.body_en, /14 days/);
  await db.query("UPDATE products SET status='active' WHERE id=$1", [target]);
  assert.equal(
    (await products()).find((x) => x.id === target)?.usage_en,
    p.usage_en,
  );
});
