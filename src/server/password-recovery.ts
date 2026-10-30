import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "./db";
import { token, hash } from "./security";
import { requireRecoveryEmail, safeEmailFailure } from "./email";
import { sendEmail } from "./integrations";
import {
  recoveryEmail,
  type RecoveryAudience,
  type RecoveryLocale,
} from "./recovery-email";
import { AppError } from "./config";

// SQL identifiers are fixed server constants, never request-controlled values.
const tables = {
  admin: {
    account: "admin_users",
    resets: "password_resets",
    owner: "admin_id",
  },
  customer: {
    account: "customer_accounts",
    resets: "customer_password_resets",
    owner: "account_id",
  },
} as const;

export async function queueRecovery(
  audience: RecoveryAudience,
  email: string,
  locale: RecoveryLocale,
) {
  requireRecoveryEmail(); // Same availability error for known and unknown addresses.
  // Shared short circuit for transport-wide failures, never recipient-specific rejection.
  const unavailable = await pool.query(
    "SELECT 1 FROM outbox WHERE kind='password-reset-email' AND status='failed' AND next_at>now() AND last_error ~ '^(EAUTH|ECONNECTION|ETIMEDOUT|ESOCKET)' LIMIT 1",
  );
  if (unavailable.rowCount) throw new AppError(503, "EMAIL_UNAVAILABLE");
  const row = (
    await pool.query(
      `SELECT id FROM ${tables[audience].account} WHERE email=$1 AND active=true`,
      [email],
    )
  ).rows[0];
  const id = randomUUID();
  // Unknown addresses get the identical queue/response path but no email. No submitted address or token is persisted.
  await pool.query(
    "INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'password-reset-email',$2,$3)",
    [
      id,
      JSON.stringify({ audience, accountId: row?.id || null, locale }),
      `recovery:${id}`,
    ],
  );
  return id;
}

export async function processRecoveryJob(id?: string) {
  const job = await transaction(async (db) => {
    const row = (
      await db.query(
        `SELECT * FROM outbox WHERE kind='password-reset-email'
      AND ($1::uuid IS NULL OR id=$1) AND attempts<3
      AND ((status IN ('pending','failed') AND next_at<=now()) OR (status='working' AND next_at<now()))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        [id || null],
      )
    ).rows[0];
    if (!row) return null;
    await db.query(
      "UPDATE outbox SET status='working',attempts=attempts+1,next_at=now()+interval '2 minutes' WHERE id=$1",
      [row.id],
    );
    return { ...row, attempts: row.attempts + 1 };
  });
  if (!job) return false;
  let resetHash: string | undefined;
  let audience: RecoveryAudience | undefined;
  let accepted = false;
  try {
    requireRecoveryEmail();
    if (Date.now() - new Date(job.created_at).getTime() > 30 * 60 * 1000) {
      await pool.query(
        "UPDATE outbox SET status='failed',attempts=3,last_error='RESET_REQUEST_EXPIRED',payload='{}' WHERE id=$1 AND attempts=$2",
        [job.id, job.attempts],
      );
      return true;
    }
    const payload = job.payload;
    if (!["customer", "admin"].includes(payload.audience))
      throw new Error("INVALID_JOB");
    audience = payload.audience as RecoveryAudience;
    const table = tables[audience];
    const account = payload.accountId
      ? (
          await pool.query(
            `SELECT id,email FROM ${table.account} WHERE id=$1 AND active=true`,
            [payload.accountId],
          )
        ).rows[0]
      : null;
    if (account) {
      const raw = token();
      resetHash = hash(raw);
      await pool.query(
        `INSERT INTO ${table.resets}(token_hash,${table.owner},expires_at) VALUES($1,$2,now()+interval '30 minutes')`,
        [resetHash, account.id],
      );
      const message = recoveryEmail(
        audience,
        raw,
        payload.locale === "ar" ? "ar" : "en",
      );
      await sendEmail(
        account.email,
        message.subject,
        message.text,
        `${job.dedupe_key}:${job.attempts}`,
        message.html,
      );
      accepted = true;
      await audit(
        pool,
        audience === "admin" ? account.id : null,
        "password.recovery-email-accepted",
        table.account,
        account.id,
        { jobId: job.id },
      );
    }
    await pool.query(
      "UPDATE outbox SET status='done',last_error=NULL,payload='{}' WHERE id=$1 AND status='working' AND attempts=$2",
      [job.id, job.attempts],
    );
  } catch (error) {
    // Keep only a hash in PostgreSQL. Failed attempts cannot leave a usable reset credential.
    if (resetHash && audience && !accepted)
      await pool.query(
        `DELETE FROM ${tables[audience].resets} WHERE token_hash=$1`,
        [resetHash],
      );
    const code = safeEmailFailure(error);
    const permanent = /^(EAUTH|EENVELOPE_5|EMESSAGE_5)/.test(code);
    await pool.query(
      "UPDATE outbox SET status='failed',last_error=$2,attempts=CASE WHEN $3 THEN 3 ELSE attempts END,next_at=now()+interval '2 minutes' WHERE id=$1 AND status='working' AND attempts=$4",
      [job.id, code, permanent, job.attempts],
    );
    console.error(
      JSON.stringify({
        event: "password.recovery-delivery-failed",
        jobId: job.id,
        code,
      }),
    );
  }
  return true;
}

// Safe wrapper for Next.js after(): a DB failure stays observable; durable jobs remain recoverable.
export async function deliverRecovery(id?: string) {
  try {
    await processRecoveryJob(id);
  } catch {
    console.error(JSON.stringify({ event: "password.recovery-worker-failed" }));
  }
}
