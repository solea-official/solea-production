import { boundedBody } from "@/server/http";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, transaction, audit } from "@/server/db";
import { AppError, requireCondition, config } from "@/server/config";
import {
  session,
  newSession,
  setSession,
  sign,
  csrf,
  rate,
  login,
  hash,
  token,
  admin,
} from "@/server/security";
import { products, publicSettings, content } from "@/server/catalog";
import {
  uuid,
  email,
  password,
  loginSchema,
  checkoutSchema,
} from "@/server/validation";
import { getCart, setCartItem, checkout, quote } from "@/server/commerce";
import { adminApi } from "@/server/admin-api";
import { webhook } from "@/server/webhooks";
import { sendEmail } from "@/server/integrations";
import {
  downloadPaymentProof,
  removeStored,
  uploadPaymentProof,
} from "@/server/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const parts = (await params).path;
  const endpoint = parts.join("/");
  const method = req.method;
  const result = (data: unknown, status = 200) =>
    NextResponse.json(data, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  let raw: string | undefined;
  async function body() {
    requireCondition(
      Number(req.headers.get("content-length") || 0) <= 65536,
      413,
      "BODY_TOO_LARGE",
    );
    requireCondition(
      req.headers.get("content-type")?.includes("application/json"),
      415,
      "JSON_REQUIRED",
    );
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBody(req),
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(400, "INVALID_ENCODING");
    }
    requireCondition(Buffer.byteLength(raw) <= 65536, 413, "BODY_TOO_LARGE");
    try {
      return JSON.parse(raw);
    } catch {
      throw new AppError(400, "INVALID_JSON");
    }
  }
  try {
    if (endpoint === "health" && method === "GET") {
      await pool.query("SELECT 1");
      return result({ status: "ok" });
    }
    if (endpoint === "session" && method === "GET") {
      await rate(req, "session", 120, 60);
      const s = (await session(req)) || (await newSession());
      const response = result({ csrf: sign(s.raw), admin: !!s.admin_id });
      setSession(response, s);
      return response;
    }
    if (endpoint === "products" && method === "GET")
      return result(await products());
    if (endpoint === "store" && method === "GET")
      return result({
        settings: await publicSettings(),
        content: await content(),
        categories: (
          await pool.query("SELECT * FROM categories ORDER BY name_en")
        ).rows,
      });
    if (endpoint === "auth/login" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      const d = loginSchema.parse(await body());
      const next = await login(req, d.email, d.password);
      const response = result({ ok: true, csrf: sign(next.raw) });
      setSession(response, next);
      return response;
    }
    if (endpoint === "auth/logout" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      await pool.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [
        s!.id,
      ]);
      const fresh = await newSession();
      const response = result({ ok: true, csrf: sign(fresh.raw) });
      setSession(response, fresh);
      return response;
    }
    if (endpoint === "auth/reset-request" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      await rate(req, "reset", 5, 3600);
      const d = z
        .object({ email })
        .strict()
        .parse(await body());
      const u = (
        await pool.query(
          "SELECT id FROM admin_users WHERE email=$1 AND active=true",
          [d.email],
        )
      ).rows[0];
      if (
        u &&
        process.env.EMAIL_ADAPTER_URL &&
        process.env.EMAIL_API_KEY &&
        process.env.EMAIL_FROM
      ) {
        const value = token();
        await pool.query(
          "INSERT INTO password_resets(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
          [hash(value), u.id],
        );
        try {
          await sendEmail(
            d.email,
            "SOLÉA — Password reset",
            config().APP_URL + "/admin?reset=" + value,
            "reset:" + hash(value),
          );
        } catch {
          await pool.query("DELETE FROM password_resets WHERE token_hash=$1", [
            hash(value),
          ]);
        }
      }
      return result({ ok: true });
    }
    if (endpoint === "auth/reset" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      await rate(req, "reset-confirm", 10, 3600);
      const d = z
        .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
        .strict()
        .parse(await body());
      await transaction(async (db) => {
        const r = (
          await db.query(
            "SELECT * FROM password_resets WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE",
            [hash(d.token)],
          )
        ).rows[0];
        requireCondition(r, 400, "INVALID_RESET");
        await db.query("UPDATE admin_users SET password_hash=$1 WHERE id=$2", [
          await bcrypt.hash(d.password, 14),
          r.admin_id,
        ]);
        await db.query(
          "UPDATE password_resets SET used_at=now() WHERE admin_id=$1",
          [r.admin_id],
        );
        await db.query(
          "UPDATE sessions SET expires_at=now() WHERE admin_id=$1",
          [r.admin_id],
        );
        await audit(
          db,
          r.admin_id,
          "password.reset",
          "admin_users",
          r.admin_id,
        );
      });
      return result({ ok: true });
    }
    if (
      parts[0] === "webhooks" &&
      method === "POST" &&
      ["payment", "bosta"].includes(parts[1])
    ) {
      await body();
      return result(await webhook(req, parts[1], raw!));
    }
    if (
      parts[0] === "admin" &&
      parts[1] === "orders" &&
      parts[3] === "payment-proof" &&
      method === "GET"
    ) {
      await rate(req, "admin", 300, 60);
      await admin(req, "payments");
      const orderId = uuid.parse(parts[2]);
      const proof = (
        await pool.query("SELECT proof_storage_path FROM payments WHERE order_id=$1", [orderId])
      ).rows[0]?.proof_storage_path;
      requireCondition(proof, 404, "FILE_NOT_FOUND");
      const buffer = await downloadPaymentProof(proof);
      return new NextResponse(new Blob([new Uint8Array(buffer)]), {
        headers: {
          "Content-Type": "image/webp",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private,no-store",
          "Content-Disposition": `inline; filename="payment-proof-${orderId}.webp"`,
        },
      });
    }
    if (parts[0] === "admin") {
      await rate(req, "admin", 300, 60);
      return result(await adminApi(req, parts, body));
    }
    const s = await session(req);
    requireCondition(s, 401, "SESSION_REQUIRED");
    if (method !== "GET") csrf(req, s);
    if (endpoint === "cart") {
      await rate(req, "cart", 120, 60, s.id);
      if (method === "GET") return result(await getCart(s));
      requireCondition(
        method === "PUT" || method === "POST",
        405,
        "METHOD_NOT_ALLOWED",
      );
      const d = z
        .object({
          productId: uuid,
          quantity: z
            .number()
            .int()
            .min(method === "POST" ? 1 : 0)
            .max(99),
        })
        .strict()
        .parse(await body());
      await setCartItem(s, d.productId, d.quantity, method === "POST");
      return result(await getCart(s));
    }
    if (endpoint === "quote" && method === "POST") {
      await rate(req, "quote", 60, 300, s.id);
      const d = z
        .object({
          governorate: z.string().max(150),
          coupon: z.string().max(40),
        })
        .strict()
        .parse(await body());
      return result(await quote(s, d.governorate, d.coupon));
    }
    if (endpoint === "checkout" && method === "POST") {
      await rate(req, "checkout", 10, 300, s.id);
      const d = checkoutSchema.parse(await body());
      return result(await checkout(s, d), 201);
    }
    if (endpoint === "payment-proof" && method === "POST") {
      await rate(req, "payment-proof", 5, 3600, s.id);
      requireCondition(Number(req.headers.get("content-length") || 0) <= 5_000_000, 413, "FILE_TOO_LARGE");
      const bytes = await boundedBody(req, 4_500_000);
      const form = await new Response(bytes, {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const orderId = uuid.parse(form.get("orderId"));
      const file = form.get("file");
      requireCondition(file instanceof File, 400, "INVALID_FILE");
      const owned = (
        await pool.query(
          `SELECT 1 FROM payments p JOIN orders o ON o.id=p.order_id
           WHERE o.id=$1 AND o.session_id=$2 AND o.payment_method IN ('instapay','vodafone_cash')
           AND o.status='pending' AND p.status='awaiting_confirmation'`,
          [orderId, s.id],
        )
      ).rowCount;
      requireCondition(owned, 404, "ORDER_NOT_FOUND");
      const path = await uploadPaymentProof(orderId, file);
      const old = await transaction(async (db) => {
        const payment = (
          await db.query(
            `SELECT p.proof_storage_path FROM payments p JOIN orders o ON o.id=p.order_id
             WHERE o.id=$1 AND o.session_id=$2 AND o.payment_method IN ('instapay','vodafone_cash')
             AND o.status='pending' AND p.status='awaiting_confirmation' FOR UPDATE OF p,o`,
            [orderId, s.id],
          )
        ).rows[0];
        requireCondition(payment, 404, "ORDER_NOT_FOUND");
        await db.query("UPDATE payments SET proof_storage_path=$1,updated_at=now() WHERE order_id=$2", [
          path,
          orderId,
        ]);
        return payment.proof_storage_path as string | null;
      });
      if (old) await removeStored(old, true);
      return result({ ok: true });
    }
    if (endpoint === "order" && method === "GET") {
      const id = uuid.parse(req.nextUrl.searchParams.get("id"));
      const o = (
        await pool.query(
          "SELECT o.id,o.reference,o.status,o.total,o.subtotal,o.discount,o.shipping,o.payment_method,o.created_at,p.status payment_status,p.transfer_reference,(p.proof_storage_path IS NOT NULL) proof_uploaded FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 AND o.session_id=$2",
          [id, s.id],
        )
      ).rows[0];
      requireCondition(o, 404, "ORDER_NOT_FOUND");
      return result({
        ...o,
        trackingToken: sign("tracking:" + o.id),
        items: (
          await pool.query(
            "SELECT name_en,name_ar,quantity,unit_price FROM order_items WHERE order_id=$1",
            [id],
          )
        ).rows,
      });
    }
    if (endpoint === "track" && method === "POST") {
      await rate(req, "tracking", 10, 300);
      const d = z
        .object({
          reference: z.string().regex(/^SOL-[A-F0-9]{16}$/),
          token: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(await body());
      const o = (
        await pool.query(
          "SELECT o.reference,o.status,o.created_at,o.updated_at,s.tracking_id,s.status shipping_status FROM orders o JOIN shipments s ON s.order_id=o.id WHERE o.reference=$1 AND o.tracking_hash=$2",
          [d.reference, hash(d.token)],
        )
      ).rows[0];
      requireCondition(o, 404, "ORDER_NOT_FOUND");
      return result(o);
    }
    if (endpoint === "newsletter" && method === "POST") {
      await rate(req, "newsletter", 5, 3600);
      const d = z
        .object({ email, consent: z.literal(true) })
        .strict()
        .parse(await body());
      const published = (
        await pool.query("SELECT published FROM content WHERE key='privacy'")
      ).rows[0]?.published;
      requireCondition(published, 409, "POLICIES_NOT_READY");
      await pool.query(
        "INSERT INTO subscribers(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET active=true,consent_at=now()",
        [d.email],
      );
      return result({ ok: true });
    }
    throw new AppError(404, "NOT_FOUND");
  } catch (e) {
    const id = randomUUID();
    if (e instanceof ZodError) return result({ error: "INVALID_INPUT" }, 400);
    if (e instanceof AppError) return result({ error: e.code }, e.status);
    const code = (e as { code?: string }).code;
    if (code === "23505") return result({ error: "ALREADY_EXISTS" }, 409);
    if (code === "23503" || code === "22P02")
      return result({ error: "INVALID_INPUT" }, 400);
    if ((e as Error).message === "INVALID_FILE")
      return result({ error: "INVALID_FILE" }, 400);
    console.error(
      JSON.stringify({
        event: "request.error",
        id,
        path: parts.slice(0, 2).join("/"),
      }),
    );
    return result({ error: "INTERNAL_ERROR", requestId: id }, 500);
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
