import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db, engine, request } from "./helpers";
import { encryptMfa, totpCode } from "../src/server/totp";
const { newSession, sign } = await import("../src/server/security");
after(async () => engine.close());

// Concurrent API requests use the PGlite transaction queue. Multi-process lock
// contention on hosted PostgreSQL is a separate deployment verification.
test("concurrent reciprocal deletion requests preserve the final account manager", async () => {
  const actors = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID(),
      secret = randomBytes(20);
    await db.query(
      "INSERT INTO admin_users(id,email,password_hash,role_id,totp_enabled,totp_ciphertext) VALUES($1,$2,'non-login-fixture','owner',true,$3)",
      [id, `${i}@example.invalid`, encryptMfa(secret, id)],
    );
    const s = await newSession(id);
    actors.push({
      id,
      secret,
      client: { cookie: `sol-session=${s.raw}`, csrf: sign(s.raw) },
    });
  }
  const [a, b] = actors;
  const responses = await Promise.all([
    request(a.client, `admin/users/${b.id}`, "DELETE", {
      code: totpCode(a.secret, Math.floor(Date.now() / 30000)),
    }),
    request(b.client, `admin/users/${a.id}`, "DELETE", {
      code: totpCode(b.secret, Math.floor(Date.now() / 30000)),
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 403]);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM admin_users WHERE active"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_logs WHERE action='ADMIN_ACCOUNT_DELETED'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM admin_identities WHERE deleted_at IS NOT NULL",
      )
    ).rows[0].n,
    1,
  );
});
