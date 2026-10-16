import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { NextRequest } from "next/server";
import { audit, pool, transaction } from "./db";
import { requireCondition } from "./config";
import {
  newSession,
  rate,
  session,
  type Session,
} from "./security";
import { base32, decryptMfa, encryptMfa, verifyTotp } from "./totp";

type PendingAdmin = {
  id: string;
  email: string;
  password_hash: string;
  totp_ciphertext: string | null;
  totp_enabled: boolean;
  totp_last_counter: number;
};

async function challenge(req: NextRequest) {
  const s = await session(req);
  requireCondition(s?.pending_admin_id, 401, "MFA_CHALLENGE_REQUIRED");
  const user = (
    await pool.query(
      `SELECT id,email,password_hash,totp_ciphertext,totp_enabled,
       totp_last_counter FROM admin_users
       WHERE id=$1 AND active=true`,
      [s.pending_admin_id],
    )
  ).rows[0] as PendingAdmin | undefined;
  requireCondition(user, 401, "MFA_CHALLENGE_REQUIRED");
  return { s, user };
}

async function finish(s: Session, adminId: string, action: string) {
  await pool.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [s.id]);
  const next = await newSession(adminId);
  await audit(pool, adminId, action, "admin_users", adminId);
  await audit(pool, adminId, "login.success", "auth", adminId);
  return next;
}

export async function mfaStatus(req: NextRequest) {
  const { user } = await challenge(req);
  return { challenge: user.totp_enabled ? "totp" : "enroll" } as const;
}

export async function beginEnrollment(req: NextRequest) {
  const { s, user } = await challenge(req);
  requireCondition(!user.totp_enabled, 409, "MFA_ALREADY_ENABLED");
  let encrypted = (
    await pool.query("SELECT enrollment_ciphertext FROM sessions WHERE id=$1", [s.id])
  ).rows[0]?.enrollment_ciphertext as string | null;
  let secret: Buffer;
  if (encrypted) secret = decryptMfa(encrypted, user.id);
  else {
    secret = randomBytes(20);
    encrypted = encryptMfa(secret, user.id);
    await pool.query("UPDATE sessions SET enrollment_ciphertext=$1 WHERE id=$2", [
      encrypted,
      s.id,
    ]);
  }
  const manualKey = base32(secret);
  const label = encodeURIComponent(`SOLÉA:${user.email}`);
  const issuer = encodeURIComponent("SOLÉA");
  const uri = `otpauth://totp/${label}?secret=${manualKey}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { manualKey, qr: await QRCode.toDataURL(uri, { margin: 2, width: 240 }) };
}

export async function enroll(req: NextRequest, code: string) {
  const { s, user } = await challenge(req);
  await rate(req, "admin-mfa-enroll", 5, 300, user.id, true);
  requireCondition(!user.totp_enabled, 409, "MFA_ALREADY_ENABLED");
  const encrypted = (
    await pool.query("SELECT enrollment_ciphertext FROM sessions WHERE id=$1", [s.id])
  ).rows[0]?.enrollment_ciphertext as string | null;
  requireCondition(encrypted, 409, "MFA_SETUP_REQUIRED");
  const secret = decryptMfa(encrypted, user.id);
  const counter = verifyTotp(secret, code, -1);
  requireCondition(counter !== null, 401, "INVALID_MFA_CODE");
  await transaction(async (db) => {
    const enabled = await db.query(
      `UPDATE admin_users SET totp_ciphertext=$1,totp_enabled=true,
       totp_last_counter=$2 WHERE id=$3 AND totp_enabled=false
       RETURNING id`,
      [encrypted, counter, user.id],
    );
    requireCondition(enabled.rowCount, 409, "MFA_ALREADY_ENABLED");
    await audit(db, user.id, "mfa.enabled", "admin_users", user.id);
  });
  return { next: await finish(s, user.id, "mfa.enrollment-completed") };
}

export async function verifyMfa(
  req: NextRequest,
  data: { code: string },
) {
  const { s, user } = await challenge(req);
  await rate(req, "admin-mfa-ip", 10, 300);
  await rate(req, "admin-mfa-account", 5, 300, user.id, true);
  requireCondition(user.totp_enabled && user.totp_ciphertext, 409, "MFA_SETUP_REQUIRED");
  await transaction(async (db) => {
    const locked = (
      await db.query(
        `SELECT totp_ciphertext,totp_last_counter FROM admin_users
         WHERE id=$1 AND active=true FOR UPDATE`,
        [user.id],
      )
    ).rows[0] as PendingAdmin;
    const counter = verifyTotp(
      decryptMfa(locked.totp_ciphertext!, user.id),
      data.code,
      Number(locked.totp_last_counter),
    );
    requireCondition(counter !== null, 401, "INVALID_MFA_CODE");
    await db.query("UPDATE admin_users SET totp_last_counter=$1 WHERE id=$2", [
      counter,
      user.id,
    ]);
  });
  return { next: await finish(s, user.id, "mfa.verified") };
}