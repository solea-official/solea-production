import { saveProof, submitTransfer, whatsappLink, expireIncompleteManualPayments } from "@/server/manual-submissions";
import { boundedBody } from "@/server/http";
import { NextRequest, NextResponse, after } from "next/server";
import { z, ZodError } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, transaction, audit } from "@/server/db";
import { AppError, requireCondition } from "@/server/config";
import {
  session,
  newSession,
  setSession,
  sign,
  csrf,
  rate,
  login,
  hash,
  admin,
} from "@/server/security";
import { products, publicSettings, content } from "@/server/catalog";
import {
  uuid,
  email,
  password,
  loginSchema,
  checkoutSchema,
  customerPassword,
  customerRegisterSchema,
  customerLoginSchema,
} from "@/server/validation";
import {
  getCart,
  setCartItem,
  checkout,
  quote,
  expirePendingPayments,
} from "@/server/commerce";
import { adminApi } from "@/server/admin-api";
import { webhook } from "@/server/webhooks";
import { paymobWebhook } from "@/server/paymob-webhook";
import { queueRecovery, deliverRecovery } from "@/server/password-recovery";
import {
  downloadPaymentProof,
  signedPaymentProof,
} from "@/server/storage";
import {
  changeCustomerPassword,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  resetCustomerPassword,
} from "@/server/customer-auth";
import { customerApi } from "@/server/customer-api";
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
    if (endpoint === "internal/maintenance" && method === "GET") {
      const secret = process.env.CRON_SECRET || "";
      requireCondition(secret.length >= 32, 503, "INTEGRATION_NOT_CONFIGURED");
      requireCondition(
        timingSafeEqual(
          Buffer.from(hash(req.headers.get("authorization") || ""), "hex"),
          Buffer.from(hash(`Bearer ${secret}`), "hex"),
        ),
        401,
        "INVALID_SIGNATURE",
      );
      if (process.env.NODE_ENV !== "test") after(() => deliverRecovery());
      return result({ ok: true, expired: await expirePendingPayments(), manualExpired:await expireIncompleteManualPayments() });
    }
    if (endpoint === "session" && method === "GET") {
      await rate(req, "session", 120, 60);
      const s = (await session(req)) || (await newSession());
      const response = result({
        csrf: sign(s.raw),
        admin: !!s.admin_id,
        customer: !!s.customer_account_id,
      });
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
      const data = z.object({ email, locale: z.enum(["en", "ar"]).default("en") }).strict().parse(await body());
      await rate(req, "reset-identity", 5, 3600, data.email, true);
      const jobId = await queueRecovery("admin", data.email, data.locale);
      if (process.env.NODE_ENV !== "test") after(() => deliverRecovery(jobId));
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
        requireCondition((await db.query("SELECT id FROM admin_users WHERE id=$1 AND active=true", [r.admin_id])).rowCount, 400, "INVALID_RESET");
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
      const fresh = await newSession();
      const response = result({ ok: true, csrf: sign(fresh.raw) });
      setSession(response, fresh);
      return response;
    }
    if (parts[0] === "auth") throw new AppError(404, "NOT_FOUND");
    if (endpoint === "account/register" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      const data = customerRegisterSchema.parse(await body());
      const { next, account } = await registerCustomer(req, data);
      const response = result({ account, csrf: sign(next.raw) }, 201);
      setSession(response, next);
      return response;
    }
    if (endpoint === "account/login" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      const data = customerLoginSchema.parse(await body());
      const { next, account } = await loginCustomer(
        req,
        data.email,
        data.password,
      );
      const response = result({ account, csrf: sign(next.raw) });
      setSession(response, next);
      return response;
    }
    if (endpoint === "account/logout" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      const next = await logoutCustomer(req);
      const response = result({ ok: true, csrf: sign(next.raw) });
      setSession(response, next);
      return response;
    }
    if (endpoint === "account/change-password" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      const data = z
        .object({
          currentPassword: z.string().min(1).max(72),
          newPassword: customerPassword,
        })
        .strict()
        .parse(await body());
      const next = await changeCustomerPassword(
        req,
        data.currentPassword,
        data.newPassword,
      );
      const response = result({ ok: true, csrf: sign(next.raw) });
      setSession(response, next);
      return response;
    }
    if (endpoint === "account/reset-request" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      await rate(req, "customer-reset", 5, 3600);
      const data = z.object({ email, locale: z.enum(["en", "ar"]).default("en") }).strict().parse(await body());
      await rate(req, "customer-reset-identity", 5, 3600, data.email, true);
      const jobId = await queueRecovery("customer", data.email, data.locale);
      if (process.env.NODE_ENV !== "test") after(() => deliverRecovery(jobId));
      return result({ ok: true });
    }
    if (endpoint === "account/reset" && method === "POST") {
      const s = await session(req);
      csrf(req, s);
      await rate(req, "customer-reset-confirm", 10, 3600);
      const data = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: customerPassword,
        })
        .strict()
        .parse(await body());
      await resetCustomerPassword(data.token, data.password);
      const fresh = await newSession();
      const response = result({ ok: true, csrf: sign(fresh.raw) });
      setSession(response, fresh);
      return response;
    }
    if (endpoint === "webhooks/paymob" && method === "POST") {
      await rate(req, "paymob-webhook", 300, 60);
      await body();
      return result(await paymobWebhook(req, raw!));
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
      ["payment-proof","payment-proof-url"].includes(parts[3]) && parts.length===4 &&
      method === "GET"
    ) {
      await rate(req, "admin", 300, 60);
      await admin(req, "payments");
      const orderId = uuid.parse(parts[2]);
      const proof = (
        await pool.query(
          "SELECT proof_storage_path FROM payments WHERE order_id=$1",
          [orderId],
        )
      ).rows[0]?.proof_storage_path;
      requireCondition(proof, 404, "FILE_NOT_FOUND");
      if(parts[3]==="payment-proof-url")return result({url:await signedPaymentProof(proof),expiresIn:60});
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
      const data = await adminApi(req, parts, body);
      if (parts[1] === "jobs" && parts[3] === "retry" && method === "POST" && process.env.NODE_ENV !== "test") after(() => deliverRecovery(parts[2]));
      return result(data);
    }
    if (parts[0] === "account") {
      const s = await session(req);
      requireCondition(s, 401, "SESSION_REQUIRED");
      if (method !== "GET") csrf(req, s);
      await rate(req, "account", 120, 60, s.id);
      return result(await customerApi(req, parts, body));
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
      requireCondition(
        Number(req.headers.get("content-length") || 0) <= 5_000_000,
        413,
        "FILE_TOO_LARGE",
      );
      const bytes = await boundedBody(req, 4_500_000);
      const form = await new Response(bytes, {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const orderId = uuid.parse(form.get("orderId"));
      const file = form.get("file");
      requireCondition(file instanceof File, 400, "INVALID_FILE");
      return result(await saveProof(s,orderId,file));
    }
    if(endpoint === "payment-submission" && method === "POST"){
      await rate(req,"payment-submission",10,3600,s.id);
      return result(await submitTransfer(s,await body()));
    }
    if(endpoint === "payment-whatsapp" && method === "GET"){
      await rate(req,"payment-whatsapp",30,300,s.id);
      return result(await whatsappLink(s,uuid.parse(req.nextUrl.searchParams.get("orderId")),req.nextUrl.searchParams.get("locale")==="ar"?"ar":"en"));
    }
    if (endpoint === "order" && method === "GET") {
      const id = uuid.parse(req.nextUrl.searchParams.get("id"));
      const o = (
        await pool.query(
          "SELECT o.id,o.reference,o.status,o.total,o.subtotal,o.discount,o.shipping,o.payment_method,o.created_at,p.status payment_status,p.transfer_reference,p.sender_phone,p.transferred_amount,p.submitted_at,p.submission_version,p.correction_allowed,p.rejection_reason,(p.proof_storage_path IS NOT NULL) proof_uploaded FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 AND (o.session_id=$2 OR o.account_id=$3)",
          [id, s.id, s.customer_account_id],
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
