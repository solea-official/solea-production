import { audit, pool, transaction } from "./db";
import { admin, rate } from "./security";
import { requireCondition } from "./config";
import { uuid } from "./validation";
import { z } from "zod";
import type { NextRequest } from "next/server";

export async function reportingState() {
  return (
    await pool.query(`SELECT s.period_id,p.starts_at FROM reporting_state s
    LEFT JOIN reporting_periods p ON p.id=s.period_id WHERE s.id=1`)
  ).rows[0];
}
export async function reportingApi(
  req: NextRequest,
  body: () => Promise<unknown>,
) {
  const { user, s } = await admin(req, "users");
  if (req.method === "GET")
    return {
      current: await reportingState(),
      periods: (
        await pool.query(
          "SELECT id,starts_at FROM reporting_periods ORDER BY starts_at DESC LIMIT 100",
        )
      ).rows,
      backups: (
        await pool.query(`SELECT id,label,created_at FROM reporting_backups b WHERE created_at>now()-interval '24 hours'
      AND NOT EXISTS(SELECT 1 FROM reporting_periods p WHERE p.backup_id=b.id) ORDER BY created_at DESC LIMIT 20`)
      ).rows,
    };
  requireCondition(req.method === "POST", 405, "METHOD_NOT_ALLOWED");
  await rate(req, "reporting-reset", 5, 3600, user.id, true);
  requireCondition(
    Date.now() - new Date(s.created_at).getTime() < 600_000,
    401,
    "RECENT_AUTH_REQUIRED",
  );
  const data = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("reset"),
          backupId: uuid,
          expectedPeriodId: uuid.nullable(),
          confirmation: z.literal("RESET"),
        })
        .strict(),
      z
        .object({
          action: z.literal("restore"),
          periodId: uuid.nullable(),
          expectedPeriodId: uuid.nullable(),
        })
        .strict(),
    ])
    .parse(await body());
  return transaction(async (db) => {
    const current = (
      await db.query(
        "SELECT period_id FROM reporting_state WHERE id=1 FOR UPDATE",
      )
    ).rows[0];
    requireCondition(
      current.period_id === data.expectedPeriodId,
      409,
      "REPORTING_CHANGED",
    );
    let next = data.action === "restore" ? data.periodId : null;
    if (data.action === "reset") {
      const backup = (
        await db.query(
          "SELECT id FROM reporting_backups WHERE id=$1 AND created_at>now()-interval '24 hours'",
          [data.backupId],
        )
      ).rows[0];
      requireCondition(backup, 409, "BACKUP_REQUIRED");
      next = (
        await db.query(
          "INSERT INTO reporting_periods(actor_id,backup_id) VALUES($1,$2) RETURNING id",
          [user.id, data.backupId],
        )
      ).rows[0].id;
    } else if (next)
      requireCondition(
        (await db.query("SELECT id FROM reporting_periods WHERE id=$1", [next]))
          .rowCount,
        404,
        "NOT_FOUND",
      );
    await db.query("UPDATE reporting_state SET period_id=$1 WHERE id=1", [
      next,
    ]);
    await audit(
      db,
      user.id,
      `reporting.${data.action}`,
      "reporting_periods",
      next,
      {
        previousPeriod: current.period_id,
        backupId: data.action === "reset" ? data.backupId : undefined,
      },
    );
    return { ok: true, periodId: next };
  });
}
