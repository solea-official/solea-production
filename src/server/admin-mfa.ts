import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { NextRequest } from "next/server";
import { audit, pool, transaction } from "./db";
import { requireCondition } from "./config";
import {
  admin,
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
  recovery_hashes: string[];
};

async function challenge(req: NextRequest) {
  const s = await session(req);
  requireCondition(s?.pending_admin_id, 401, "MFA_CHALLENGE_REQUIRED");
  const user = (
    await pool.query(
      `SELECT id,email,password_hash,totp_ciphertext,totp_enabled,
       totp_last_counter,recovery_hashes FROM admin_users
       WHERE id=$1 AND active=true`,
      [s.pending_admin_id],
    )
  ).rows[0] as PendingAdmin | undefined;
  requireCondition(user, 401, "MFA_CHALLENGE_REQUIRED");
  return { s, user };
}

function recoveryCodes() {
  return Array.from({ length: 10 }, () =>
    randomBytes(9).toString("base64url").toUpperCase(),
  );
}

function recoveryHash(value: string) {
  return createHash("sha256")
    .update(value.trim().toUpperCase())
    .digest("hex");
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
  const codes = recoveryCodes();
  await transaction(async (db) => {
    const enabled = await db.query(
      `UPDATE admin_users SET totp_ciphertext=$1,totp_enabled=true,
       totp_last_counter=$2,recovery_hashes=$3 WHERE id=$4 AND totp_enabled=false
       RETURNING id`,
      [encrypted, counter, JSON.stringify(codes.map(recoveryHash)), user.id],
    );
    requireCondition(enabled.rowCount, 409, "MFA_ALREADY_ENABLED");
    await audit(db, user.id, "mfa.enabled", "admin_users", user.id);
  });
  return { next: await finish(s, user.id, "mfa.enrollment-completed"), recoveryCodes: codes };
}

export async function verifyMfa(
  req: NextRequest,
  data: { code?: string; recoveryCode?: string },
) {
  const { s, user } = await challenge(req);
  await rate(req, "admin-mfa-ip", 10, 300);
  await rate(req, "admin-mfa-account", 5, 300, user.id, true);
  requireCondition(user.totp_enabled && user.totp_ciphertext, 409, "MFA_SETUP_REQUIRED");
  let action = "mfa.verified";
  await transaction(async (db) => {
    const locked = (
      await db.query(
        `SELECT totp_ciphertext,totp_last_counter,recovery_hashes FROM admin_users
         WHERE id=$1 AND active=true FOR UPDATE`,
        [user.id],
      )
    ).rows[0] as PendingAdmin;
    if (data.code) {
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
    } else {
      const value = recoveryHash(data.recoveryCode || "");
      const hashes = locked.recovery_hashes || [];
      const index = hashes.findIndex(
        (entry) =>
          entry.length === value.length &&
          timingSafeEqual(Buffer.from(entry), Buffer.from(value)),
      );
      requireCondition(index >= 0, 401, "INVALID_MFA_CODE");
      hashes.splice(index, 1);
      await db.query("UPDATE admin_users SET recovery_hashes=$1 WHERE id=$2", [
        JSON.stringify(hashes),
        user.id,
      ]);
      action = "mfa.recovery-used";
      await audit(db, user.id, action, "admin_users", user.id);
    }
  });
  return { next: await finish(s, user.id, action) };
}

export async function regenerateRecovery(
  req: NextRequest,
  password: string,
  code: string,
) {
  const { s, user } = await admin(req, "users");
  requireCondition(
    s.mfa_verified_at && Date.now() - new Date(s.mfa_verified_at).getTime() < 10 * 60_000,
    401,
    "RECENT_MFA_REQUIRED",
  );
  const codes = recoveryCodes();
  await transaction(async (db) => {
    const row = (
      await db.query(
        `SELECT password_hash,totp_ciphertext,totp_last_counter FROM admin_users
         WHERE id=$1 AND active=true FOR UPDATE`,
        [user.id],
      )
    ).rows[0];
    requireCondition(await bcrypt.compare(password, row.password_hash), 401, "INVALID_LOGIN");
    const counter = verifyTotp(
      decryptMfa(row.totp_ciphertext, user.id),
      code,
      Number(row.totp_last_counter),
    );
    requireCondition(counter !== null, 401, "INVALID_MFA_CODE");
    await db.query(
      "UPDATE admin_users SET totp_last_counter=$1,recovery_hashes=$2 WHERE id=$3",
      [counter, JSON.stringify(codes.map(recoveryHash)), user.id],
    );
    await audit(db, user.id, "mfa.recovery-regenerated", "admin_users", user.id);
  });
  return { recoveryCodes: codes };
}
