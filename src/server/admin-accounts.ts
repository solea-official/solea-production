import { NextRequest } from "next/server";
import { z } from "zod";
import { audit, pool, transaction, type DB } from "./db";
import { AppError, requireCondition } from "./config";
import { admin, rate, type Session } from "./security";
import { uuid } from "./validation";
import { decryptMfa, verifyTotp } from "./totp";

// Serialize account deletion against account creation, role and active changes.
// Revalidate authorization after acquiring the lock, including a revoked session.
export async function lockAccountManager(db: DB, actorId: string, s: Session) {
  await db.query("LOCK TABLE admin_users IN SHARE ROW EXCLUSIVE MODE");
  const actor = (
    await db.query(
      `SELECT a.id,a.email,a.totp_ciphertext,a.totp_last_counter
     FROM admin_users a JOIN roles r ON r.id=a.role_id JOIN sessions s ON s.admin_id=a.id
     WHERE a.id=$1 AND s.id=$2 AND a.active AND a.totp_enabled
       AND 'users'=ANY(r.permissions) AND s.mfa_verified_at IS NOT NULL
       AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'`,
      [actorId, s.id],
    )
  ).rows[0];
  requireCondition(actor, 403, "FORBIDDEN");
  return actor as {
    id: string;
    email: string;
    totp_ciphertext: string;
    totp_last_counter: string;
  };
}

export async function protectLastManager(db: DB, targetId: string) {
  const remaining = (
    await db.query(
      `SELECT count(*)::int n FROM admin_users a JOIN roles r ON r.id=a.role_id
     WHERE a.active AND 'users'=ANY(r.permissions) AND a.id<>$1`,
      [targetId],
    )
  ).rows[0].n;
  requireCondition(remaining > 0, 409, "LAST_ADMIN_FORBIDDEN");
}

export async function deleteAdminAccount(
  req: NextRequest,
  target: string,
  body: () => Promise<unknown>,
) {
  // Permission failures are logged without accepting a browser-supplied identity.
  const { user, s } = await admin(req);
  const targetId = uuid.parse(target);
  try {
    await rate(req, "admin-delete-ip", 15, 300);
    await rate(req, "admin-delete-account", 5, 300, user.id, true);
    requireCondition(user.permissions.includes("users"), 403, "FORBIDDEN");
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(await body());
    await transaction(async (db) => {
      const actor = await lockAccountManager(db, user.id, s);
      requireCondition(targetId !== actor.id, 409, "SELF_DELETE_FORBIDDEN");
      const target = (
        await db.query(
          "SELECT id,email,role_id FROM admin_users WHERE id=$1 FOR UPDATE",
          [targetId],
        )
      ).rows[0];
      requireCondition(target, 404, "ADMIN_DELETE_UNAVAILABLE");
      await protectLastManager(db, targetId);
      const counter = verifyTotp(
        decryptMfa(actor.totp_ciphertext, actor.id),
        code,
        Number(actor.totp_last_counter),
      );
      requireCondition(counter !== null, 401, "INVALID_MFA_CODE");
      await db.query(
        "UPDATE admin_users SET totp_last_counter=$1 WHERE id=$2",
        [counter, actor.id],
      );
      // The identity-preservation trigger revokes sessions/reset tokens atomically.
      await db.query("DELETE FROM admin_users WHERE id=$1", [targetId]);
      await audit(
        db,
        actor.id,
        "ADMIN_ACCOUNT_DELETED",
        "admin_users",
        targetId,
        {
          actorEmail: actor.email,
          deletedAdminId: targetId,
          deletedAdminEmail: target.email,
          deletedAdminRole: target.role_id,
        },
      );
    });
    return { ok: true };
  } catch (error) {
    // A separate transaction preserves a failed-attempt event after rollback.
    await audit(
      pool,
      user.id,
      "ADMIN_ACCOUNT_DELETE_DENIED",
      "admin_users",
      targetId,
      {
        reason:
          error instanceof AppError
            ? error.code
            : error instanceof z.ZodError
              ? "INVALID_INPUT"
              : "FAILED",
      },
    );
    throw error;
  }
}
