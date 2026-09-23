import { boundedBody } from "./http";
import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool, transaction, audit } from "./db";
import { admin } from "./security";
import { products } from "./catalog";
import {
  productSchema,
  settingsSchema,
  couponSchema,
  contentSchema,
  uuid,
  email,
  password,
} from "./validation";
import { AppError, requireCondition } from "./config";
import { changeOrder, enqueue } from "./commerce";
import {
  removeStored,
  uploadProductImage,
} from "./storage";
import { verifyManualPayment } from "./manual-payments";
export async function adminApi(
  req: NextRequest,
  parts: string[],
  body: () => Promise<unknown>,
) {
  const [, resource, id, action, childId] = parts;
  const method = req.method;
  const permission = (
    {
      products: "products",
      categories: "products",
      orders: "orders",
      customers: "customers",
      content: "content",
      settings: "settings",
      audit: "audit",
      coupons: "coupons",
      users: "users",
      sessions: "users",
      jobs: "settings",
      payments: "payments",
    } as Record<string, string>
  )[resource];
  const { user } = await admin(req, permission);
  if (resource === "me") return user;
  if (resource === "jobs") {
    if (method === "GET")
      return (
        await pool.query(
          "SELECT id,kind,order_id,status,attempts,last_error,created_at FROM outbox WHERE status IN ('failed','working','pending') ORDER BY created_at DESC LIMIT 100",
        )
      ).rows;
    requireCondition(
      method === "POST" && action === "retry",
      405,
      "METHOD_NOT_ALLOWED",
    );
    uuid.parse(id);
    await transaction(async (db) => {
      const r = await db.query(
        "UPDATE outbox SET status='pending',attempts=0,next_at=now(),last_error=NULL WHERE id=$1 AND status='failed' RETURNING id",
        [id],
      );
      requireCondition(r.rowCount, 409, "INVALID_TRANSITION");
      await audit(db, user.id, "job.retry", "outbox", id);
    });
    return { ok: true };
  }
  if (resource === "dashboard") {
    const allowed = user.permissions.includes("orders");
    return {
      orders: allowed
        ? (
            await pool.query(
              `SELECT o.status,count(*)::int order_count,
               COALESCE(sum((SELECT sum(quantity) FROM order_items WHERE order_id=o.id)),0)::int units
               FROM orders o GROUP BY o.status ORDER BY o.status`,
            )
          ).rows
        : [],
      metrics: allowed
        ? (
            await pool.query(
              `SELECT count(*)::int total_orders,
               COALESCE(sum((SELECT sum(quantity) FROM order_items WHERE order_id=o.id)),0)::int units_ordered,
               count(*) FILTER (WHERE o.status='pending')::int pending_orders,
               count(*) FILTER (WHERE o.status='delivered')::int delivered_orders,
               count(*) FILTER (WHERE o.status='cancelled')::int cancelled_orders,
               count(*) FILTER (WHERE p.status='awaiting_confirmation')::int pending_payments,
               COALESCE(sum(o.total) FILTER (WHERE p.status='paid'),0)::int revenue
               FROM orders o JOIN payments p ON p.order_id=o.id`,
            )
          ).rows[0]
        : {},
      products: user.permissions.includes("products")
        ? (
            await pool.query(
              "SELECT count(*)::int total FROM products WHERE status='active'",
            )
          ).rows[0].total
        : 0,
      jobs: user.permissions.includes("settings")
        ? (
            await pool.query(
              "SELECT count(*)::int total FROM outbox WHERE status='failed'",
            )
          ).rows[0].total
        : 0,
    };
  }
  if (resource === "products") {
    if (method === "GET")
      return id
        ? ((await products(true)).find((p) => p.id === uuid.parse(id)) ?? null)
        : products(true);
    if (action === "images" && (method === "POST" || (method === "PUT" && childId))) {
      uuid.parse(id);
      requireCondition(
        (await pool.query("SELECT 1 FROM products WHERE id=$1", [id])).rowCount,
        404,
        "PRODUCT_NOT_FOUND",
      );
      requireCondition(
        Number(req.headers.get("content-length") || 0) <= 5000000,
        413,
        "FILE_TOO_LARGE",
      );
      const count = await pool.query(
        "SELECT count(*)::int n FROM product_images WHERE product_id=$1",
        [id],
      );
      requireCondition(method === "PUT" || count.rows[0].n < 20, 409, "IMAGE_LIMIT");
      const bytes = await boundedBody(req, 4500000);
      const f = await new Response(bytes, {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const file = f.get("file");
      requireCondition(file instanceof File, 400, "INVALID_FILE");
      const replaceCurrent = childId
        ? (
            await pool.query(
              "SELECT storage_path FROM product_images WHERE id=$1 AND product_id=$2",
              [uuid.parse(childId), id],
            )
          ).rows[0]
        : null;
      if (method === "PUT") requireCondition(replaceCurrent, 404, "IMAGE_NOT_FOUND");
      const uploaded = await uploadProductImage(id, file);
      if (method === "PUT") {
        await pool.query(
          "UPDATE product_images SET url=$1,storage_path=$2 WHERE id=$3 AND product_id=$4",
          [uploaded.url, uploaded.path, childId, id],
        );
        if (replaceCurrent.storage_path) await removeStored(replaceCurrent.storage_path);
        await audit(pool, user.id, "image.replace", "products", id, { imageId: childId });
        return (
          await pool.query("SELECT * FROM product_images WHERE id=$1", [childId])
        ).rows[0];
      }
      const img = await pool.query(
        "INSERT INTO product_images(product_id,url,storage_path,alt_en,alt_ar,position) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(position),-1)+1 FROM product_images WHERE product_id=$1)) RETURNING *",
        [id, uploaded.url, uploaded.path, "SOLÉA product", "منتج SOLÉA"],
      );
      await audit(pool, user.id, "image.upload", "products", id);
      return img.rows[0];
    }
    if (action === "images" && method === "DELETE" && childId) {
      uuid.parse(id);
      uuid.parse(childId);
      const current = (
        await pool.query(
          "SELECT storage_path FROM product_images WHERE id=$1 AND product_id=$2",
          [childId, id],
        )
      ).rows[0];
      requireCondition(current, 404, "IMAGE_NOT_FOUND");
      if (current.storage_path) await removeStored(current.storage_path);
      await pool.query("DELETE FROM product_images WHERE id=$1 AND product_id=$2", [
        childId,
        id,
      ]);
      await audit(pool, user.id, "image.delete", "products", id, { imageId: childId });
      return { ok: true };
    }
    if (action === "images" && method === "PUT") {
      uuid.parse(id);
      const d = z
        .object({
          images: z
            .array(
              z
                .object({
                  id: uuid,
                  alt_en: z.string().min(1).max(200),
                  alt_ar: z.string().min(1).max(200),
                })
                .strict(),
            )
            .max(20),
        })
        .strict()
        .parse(await body());
      requireCondition(
        new Set(d.images.map((x) => x.id)).size === d.images.length,
        400,
        "INVALID_IMAGES",
      );
      await transaction(async (db) => {
        const current = (
          await db.query("SELECT id FROM product_images WHERE product_id=$1", [
            id,
          ])
        ).rows;
        requireCondition(
          d.images.length === current.length &&
            d.images.every((x) => current.some((y) => y.id === x.id)),
          400,
          "INVALID_IMAGES",
        );
        for (const [i, img] of d.images.entries())
          await db.query(
            "UPDATE product_images SET position=$1,alt_en=$2,alt_ar=$3 WHERE product_id=$4 AND id=$5",
            [i, img.alt_en, img.alt_ar, id, img.id],
          );
        await audit(db, user.id, "image.reorder", "products", id);
      });
      return { ok: true };
    }
    requireCondition(
      method === "POST" || method === "PUT",
      405,
      "METHOD_NOT_ALLOWED",
    );
    const d = productSchema.parse(await body());
    if (id) uuid.parse(id);
    const fields = [
      "sku",
      "slug",
      "name_en",
      "name_ar",
      "description_en",
      "description_ar",
      "volume",
      "category_id",
      "price",
      "status",
      "usage_en",
      "usage_ar",
      "warnings_en",
      "warnings_ar",
      "inci",
      "seo_title",
      "seo_description",
    ] as const;
    return transaction(async (db) => {
      const values = fields.map((k) => d[k]);
      const result = id
        ? await db.query(
            "UPDATE products SET " +
              fields.map((f, i) => f + "=$" + (i + 1)).join(",") +
              ",updated_at=now() WHERE id=$" +
              (fields.length + 1) +
              " RETURNING id",
            [...values, id],
          )
        : await db.query(
            "INSERT INTO products(" +
              fields.join(",") +
              ") VALUES(" +
              fields.map((_, i) => "$" + (i + 1)).join(",") +
              ") RETURNING id",
            values,
          );
      requireCondition(result.rows[0], 404, "PRODUCT_NOT_FOUND");
      const productId = result.rows[0].id;
      await db.query(
        "INSERT INTO inventory(product_id,stock) VALUES($1,$2) ON CONFLICT(product_id) DO UPDATE SET stock=EXCLUDED.stock,updated_at=now()",
        [productId, d.stock],
      );
      await audit(
        db,
        user.id,
        id ? "product.update" : "product.create",
        "products",
        productId,
        { status: d.status, price: d.price, stock: d.stock },
      );
      return { id: productId };
    });
  }
  if (resource === "categories") {
    if (method === "GET")
      return (await pool.query("SELECT * FROM categories ORDER BY name_en"))
        .rows;
    requireCondition(method === "POST", 405, "METHOD_NOT_ALLOWED");
    const d = z
      .object({
        name_en: z.string().min(1).max(100),
        name_ar: z.string().min(1).max(100),
        slug: z.string().regex(/^[a-z0-9-]{1,100}$/),
      })
      .strict()
      .parse(await body());
    const r = await pool.query(
      "INSERT INTO categories(name_en,name_ar,slug) VALUES($1,$2,$3) RETURNING *",
      [d.name_en, d.name_ar, d.slug],
    );
    await audit(pool, user.id, "category.create", "categories", r.rows[0].id);
    return r.rows[0];
  }
  if (resource === "orders") {
    if (id) uuid.parse(id);
    if (method === "GET") {
      if (id) {
        const o = (
          await pool.query(
            "SELECT o.*,c.name,c.email,c.mobile,a.governorate,a.city,a.street,a.building,a.floor,a.apartment,p.status payment_status,p.provider_id payment_provider,p.transfer_reference,p.proof_storage_path,p.verified_at,p.rejection_reason,v.email payment_verified_by,s.status shipping_status,s.tracking_id FROM orders o JOIN customers c ON c.id=o.customer_id JOIN addresses a ON a.id=o.address_id JOIN payments p ON p.order_id=o.id LEFT JOIN admin_users v ON v.id=p.verified_by JOIN shipments s ON s.order_id=o.id WHERE o.id=$1",
            [id],
          )
        ).rows[0];
        requireCondition(o, 404, "ORDER_NOT_FOUND");
        delete o.tracking_hash;
        delete o.request_hash;
        return {
          ...o,
          items: (
            await pool.query("SELECT * FROM order_items WHERE order_id=$1", [
              id,
            ])
          ).rows,
        };
      }
      const q = (req.nextUrl.searchParams.get("q") || "").slice(0, 100);
      return (
        await pool.query(
          "SELECT o.id,o.reference,o.status,o.payment_method,o.total,o.created_at,c.name,p.status payment_status FROM orders o JOIN customers c ON c.id=o.customer_id JOIN payments p ON p.order_id=o.id WHERE o.reference ILIKE $1 OR c.email ILIKE $1 ORDER BY o.created_at DESC LIMIT 100",
          ["%" + q + "%"],
        )
      ).rows;
    }
    requireCondition(id && method === "POST", 405, "METHOD_NOT_ALLOWED");
    if (action === "confirm-payment" || action === "reject-payment") {
      await admin(req, "payments");
      const data = action === "reject-payment"
        ? z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(await body())
        : z.object({}).strict().parse(await body());
      return verifyManualPayment(
        user.id,
        id,
        action === "confirm-payment" ? "paid" : "rejected",
        "reason" in data ? data.reason : "",
      );
    }
    if (action === "collect-cod") {
      await admin(req, "payments");
      await transaction(async (db) => {
        const o = (
          await db.query(
            "SELECT o.*,p.status payment_status FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 FOR UPDATE OF o,p",
            [id],
          )
        ).rows[0];
        requireCondition(
          o &&
            o.status === "delivered" &&
            o.payment_method === "cod" &&
            o.payment_status === "cod_pending",
          409,
          "INVALID_TRANSITION",
        );
        await db.query(
          "UPDATE payments SET status='paid',updated_at=now() WHERE order_id=$1",
          [id],
        );
        await audit(db, user.id, "payment.cod-collected", "orders", id);
        if (process.env.EMAIL_ENABLED === "true")
          await enqueue(db, "status-email", id, "cod-collected:" + id);
      });
      return { ok: true };
    }
    const d = z
      .object({
        status: z.enum(["processing", "shipped", "delivered", "cancelled"]),
      })
      .strict()
      .parse(await body());
    await changeOrder(user.id, id, d.status);
    return { ok: true };
  }
  if (resource === "customers") {
    requireCondition(method === "GET", 405, "METHOD_NOT_ALLOWED");
    const q = (req.nextUrl.searchParams.get("q") || "").slice(0, 100);
    return (
      await pool.query(
        "SELECT c.id,c.name,c.email,c.mobile,o.id order_id,o.reference,o.created_at FROM customers c JOIN orders o ON o.customer_id=c.id WHERE c.email ILIKE $1 OR c.mobile ILIKE $1 OR o.reference ILIKE $1 ORDER BY o.created_at DESC LIMIT 100",
        ["%" + q + "%"],
      )
    ).rows;
  }
  if (resource === "content") {
    if (method === "GET")
      return (await pool.query("SELECT * FROM content ORDER BY key")).rows;
    requireCondition(method === "PUT", 405, "METHOD_NOT_ALLOWED");
    const d = contentSchema.parse(await body());
    await transaction(async (db) => {
      await db.query(
        "INSERT INTO content(key,title_en,title_ar,body_en,body_ar,published) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO UPDATE SET title_en=EXCLUDED.title_en,title_ar=EXCLUDED.title_ar,body_en=EXCLUDED.body_en,body_ar=EXCLUDED.body_ar,published=EXCLUDED.published,updated_at=now()",
        [d.key, d.title_en, d.title_ar, d.body_en, d.body_ar, d.published],
      );
      await audit(db, user.id, "content.update", "content", d.key);
    });
    return { ok: true };
  }
  if (resource === "settings") {
    if (method === "GET")
      return (await pool.query("SELECT * FROM store_settings WHERE id=1"))
        .rows[0];
    requireCondition(method === "PUT", 405, "METHOD_NOT_ALLOWED");
    const d = settingsSchema.parse(await body());
    await transaction(async (db) => {
      await db.query(
        "UPDATE store_settings SET enabled=$1,cod_enabled=$2,phone=$3,instagram=$4,shipping_zones=$5,free_shipping_threshold=$6,updated_at=now() WHERE id=1",
        [
          d.enabled,
          d.cod_enabled,
          d.phone,
          d.instagram,
          JSON.stringify(d.shipping_zones),
          d.free_shipping_threshold,
        ],
      );
      await audit(db, user.id, "settings.update", "settings", "1");
    });
    return { ok: true };
  }
  if (resource === "audit") {
    requireCondition(method === "GET", 405, "METHOD_NOT_ALLOWED");
    return (
      await pool.query(
        "SELECT l.*,a.email actor FROM audit_logs l LEFT JOIN admin_users a ON a.id=l.actor_id ORDER BY l.created_at DESC LIMIT 200",
      )
    ).rows;
  }
  if (resource === "coupons") {
    if (method === "GET")
      return (await pool.query("SELECT * FROM coupons ORDER BY code LIMIT 200"))
        .rows;
    requireCondition(
      method === "POST" || method === "PUT",
      405,
      "METHOD_NOT_ALLOWED",
    );
    const d = couponSchema.parse(await body());
    if (id) uuid.parse(id);
    const fields = [
      "code",
      "type",
      "value",
      "active",
      "starts_at",
      "ends_at",
      "usage_limit",
      "minimum",
    ] as const;
    const values = fields.map((k) => d[k]);
    const result = id
      ? await pool.query(
          "UPDATE coupons SET " +
            fields.map((f, i) => f + "=$" + (i + 1)).join(",") +
            " WHERE id=$9 RETURNING id",
          [...values, id],
        )
      : await pool.query(
          "INSERT INTO coupons(" +
            fields.join(",") +
            ") VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          values,
        );
    requireCondition(result.rows[0], 404, "NOT_FOUND");
    await audit(pool, user.id, "coupon.save", "coupons", result.rows[0].id);
    return { ok: true };
  }
  if (resource === "users") {
    if (method === "GET")
      return (
        await pool.query(
          "SELECT id,email,role_id,active,mfa_required FROM admin_users ORDER BY created_at",
        )
      ).rows;
    if (method === "POST") {
      const d = z
        .object({
          email,
          password,
          role: z.enum(["owner", "manager", "support"]),
        })
        .strict()
        .parse(await body());
      const r = await pool.query(
        "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,$3) RETURNING id",
        [d.email, await bcrypt.hash(d.password, 12), d.role],
      );
      await audit(pool, user.id, "admin.create", "admin_users", r.rows[0].id);
      return { id: r.rows[0].id };
    }
    if (method === "PUT") {
      uuid.parse(id);
      const d = z
        .object({
          active: z.boolean(),
          role: z.enum(["owner", "manager", "support"]),
        })
        .strict()
        .parse(await body());
      requireCondition(id !== user.id, 409, "SELF_CHANGE_FORBIDDEN");
      await transaction(async (db) => {
        await db.query(
          "UPDATE admin_users SET active=$1,role_id=$2 WHERE id=$3",
          [d.active, d.role, id],
        );
        await db.query(
          "UPDATE sessions SET expires_at=now() WHERE admin_id=$1",
          [id],
        );
        await audit(db, user.id, "admin.update", "admin_users", id);
      });
      return { ok: true };
    }
  }
  if (resource === "sessions" && method === "DELETE") {
    uuid.parse(id);
    await pool.query("UPDATE sessions SET expires_at=now() WHERE admin_id=$1", [
      id,
    ]);
    await audit(pool, user.id, "session.revoke", "admin_users", id);
    return { ok: true };
  }
  throw new AppError(404, "NOT_FOUND");
}
