import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, engine, request } from "./helpers";
const { newSession, sign } = await import("../src/server/security");
after(async () => engine.close());

// Concurrent API requests use the PGlite transaction queue. Multi-process lock
// contention on hosted PostgreSQL is a separate deployment verification.
test("concurrent reciprocal deletion requests preserve the final account manager", async () => {
  const actors = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO admin_users(id,email,password_hash,role_id) VALUES($1,$2,'non-login-fixture','owner')",
      [id, `${i}@example.invalid`],
    );
    const s = await newSession(id);
    actors.push({
      id,
      client: { cookie: `sol-session=${s.raw}`, csrf: sign(s.raw) },
    });
  }
  const [a, b] = actors;
  const responses = await Promise.all([
    request(a.client, `admin/users/${b.id}`, "DELETE", {}),
    request(b.client, `admin/users/${a.id}`, "DELETE", {}),
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
