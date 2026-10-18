import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { pool, transaction, audit } from "./db";
import { AppError, config, requireCondition } from "./config";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const sign = (s: string, secret = config().SESSION_SECRET) =>
  createHmac("sha256", secret).update(s).digest("hex");
export const sessionCookie = () =>
  process.env.NODE_ENV === "production" ? "__Host-sol-session" : "sol-session";
export type Session = {
  id: string;
  admin_id: string | null;
  customer_account_id: string | null;
  csrf_hash: string;
  raw: string;
  created_at: Date;
};
export async function session(req: NextRequest): Promise<Session | null> {
  const raw = req.cookies.get(sessionCookie())?.value;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const r = await pool.query(
    `UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now()
     AND (admin_id IS NULL OR last_seen_at>now()-interval '30 minutes')
     AND (customer_account_id IS NULL OR last_seen_at>now()-interval '7 days')
     RETURNING id,admin_id,customer_account_id,csrf_hash,created_at`,
    [hash(raw)],
  );
  return r.rows[0] ? { ...r.rows[0], raw } : null;
}
export async function newSession(
  adminId: string | null = null,
  customerAccountId: string | null = null,
) {
  const raw = token();
  const r = await pool.query(
    `INSERT INTO sessions(token_hash,admin_id,customer_account_id,csrf_hash,expires_at)
     VALUES($1,$2,$3,$4,now()+$5::interval)
     RETURNING id,admin_id,customer_account_id,csrf_hash,created_at`,
    [
      hash(raw),
      adminId,
      customerAccountId,
      hash(sign(raw)),
      adminId ? "2 hours" : customerAccountId ? "30 days" : "14 days",
    ],
  );
  return { ...r.rows[0], raw } as Session;
}
export function setSession(res: NextResponse, s: Session) {
  res.cookies.set(sessionCookie(), s.raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: s.admin_id ? 7200 : s.customer_account_id ? 2592000 : 1209600,
  });
}
export function csrf(req: NextRequest, s: Session | null) {
  requireCondition(s, 401, "SESSION_REQUIRED");
  requireCondition(
    req.headers.get("origin") === new URL(config().APP_URL).origin,
    403,
    "CSRF_REJECTED",
  );
  const raw = req.headers.get("x-csrf-token") || "";
  requireCondition(
    raw.length === 64 && hash(raw) === s.csrf_hash,
    403,
    "CSRF_REJECTED",
  );
}
export function rateKey(req: NextRequest, scope: string, identity: string) {
  const ip =
    process.env.VERCEL === "1"
      ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
      : process.env.TRUST_PROXY === "true"
        ? req.headers.get("x-real-ip") || "unknown"
        : "direct";
  return hash(`${scope}:${ip}:${identity}`);
}
export async function rate(
  req: NextRequest,
  scope: string,
  limit: number,
  seconds: number,
  identity = "",
  globalIdentity = false,
) {
  const key = globalIdentity
    ? hash(`${scope}:identity:${identity}`)
    : rateKey(req, scope, identity);
  const r = await pool.query(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2::interval) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+$2::interval ELSE rate_limits.expires_at END RETURNING count`,
    [key, seconds + " seconds"],
  );
  requireCondition(r.rows[0].count <= limit, 429, "RATE_LIMITED");
}
export async function admin(req: NextRequest, permission?: string) {
  const s = await session(req);
  requireCondition(s?.admin_id, 401, "LOGIN_REQUIRED");
  const r = await pool.query(
    "SELECT a.id,a.email,a.role_id,r.permissions FROM admin_users a JOIN roles r ON r.id=a.role_id WHERE a.id=$1 AND a.active=true",
    [s.admin_id],
  );
  const user = r.rows[0];
  requireCondition(user, 401, "LOGIN_REQUIRED");
  if (permission)
    requireCondition(user.permissions.includes(permission), 403, "FORBIDDEN");
  if (!["GET", "HEAD"].includes(req.method)) csrf(req, s);
  return { s, user } as {
    s: Session;
    user: { id: string; email: string; role_id: string; permissions: string[] };
  };
}
export async function login(req: NextRequest, email: string, password: string) {
  await rate(req, "login-ip", 30, 900);
  await rate(req, "login-account", 5, 900, email);
  await rate(req, "login-distributed", 30, 900, email, true);
  const r = await pool.query("SELECT * FROM admin_users WHERE email=$1", [
    email,
  ]);
  const u = r.rows[0];
  const dummy = "$2b$12$9hLKcAjJOqWeUkXZbvEI8.l.MRbYDyFD.pDgSoZPdcJhCoDXnG0G6";
  const valid = await bcrypt.compare(password, u?.password_hash || dummy);
  if (!valid || !u?.active) {
    await audit(pool, null, "login.failed", "auth", null, {
      account: hash(email),
    });
    throw new AppError(401, "INVALID_LOGIN");
  }
  await pool.query("DELETE FROM rate_limits WHERE key=$1", [
    rateKey(req, "login-account", email),
  ]);
  await pool.query("DELETE FROM rate_limits WHERE key=$1", [
    hash(`login-distributed:identity:${email}`),
  ]);
  const old = await session(req);
  const s = await newSession(u.id);
  await transaction(async (db) => {
    if (old)
      await db.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [
        old.id,
      ]);
    await audit(db, u.id, "login.success", "auth", u.id);
  });
  return s;
}
export function verifyWebhook(
  raw: string,
  timestamp: string | null,
  signature: string | null,
  secret: string | undefined,
) {
  requireCondition(
    secret && secret.length >= 32,
    503,
    "INTEGRATION_NOT_CONFIGURED",
  );
  requireCondition(
    timestamp &&
      /^\d{10}$/.test(timestamp) &&
      Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300,
    401,
    "INVALID_SIGNATURE",
  );
  const expected = sign(timestamp + "." + raw, secret);
  requireCondition(
    signature && /^[a-f0-9]{64}$/.test(signature),
    401,
    "INVALID_SIGNATURE",
  );
  requireCondition(
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
    401,
    "INVALID_SIGNATURE",
  );
}
