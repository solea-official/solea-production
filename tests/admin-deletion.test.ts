import { after, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import {
  auth,
  client,
  customerClient,
  clearRates,
  db,
  engine,
  request,
  type Client,
} from "./helpers";
import { decryptMfa, encryptMfa, totpCode } from "../src/server/totp";
const { protectLastManager } = await import("../src/server/admin-accounts");
const { transaction } = await import("../src/server/db");

beforeEach(clearRates);
after(async () => engine.close());
async function account(role = "owner") {
  const email = `${randomUUID()}@example.invalid`;
  const password = `Fixture9${randomBytes(12).toString("hex")}`;
  const { id } = (
    await db.query(
      "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,$3) RETURNING id",
      [email, await bcrypt.hash(password, 4), role],
    )
  ).rows[0];
  return {
    id: id as string,
    email,
    password,
    client: await auth(email, password),
  };
}
async function fresh<T>(actorId: string, fn: (code: string) => Promise<T>) {
  const a = (
    await db.query(
      "SELECT totp_ciphertext,totp_last_counter FROM admin_users WHERE id=$1",
      [actorId],
    )
  ).rows[0];
  const counter = Math.max(
    Math.floor(Date.now() / 30000),
    Number(a.totp_last_counter) + 1,
  );
  const clock = mock.method(Date, "now", () => counter * 30000);
  try {
    return await fn(totpCode(decryptMfa(a.totp_ciphertext, actorId), counter));
  } finally {
    clock.mock.restore();
  }
}
const remove = (
  c: Client | null,
  id: string,
  data: unknown,
  headers: Record<string, string> = {},
) => request(c, `admin/users/${id}`, "DELETE", data, headers);
const exists = async (id: string) =>
  Boolean(
    (await db.query("SELECT id FROM admin_users WHERE id=$1", [id])).rowCount,
  );

test("manager, customer, anonymous and password-only sessions cannot delete administrators", async () => {
  const owner = await account();
  const manager = await account("manager");
  assert.equal(
    (await remove(manager.client, owner.id, { code: "123456" })).status,
    403,
  );
  assert.equal((await remove(null, owner.id, { code: "123456" })).status, 401);
  assert.equal(
    (await remove(await customerClient(), owner.id, { code: "123456" })).status,
    401,
  );
  const c = await client();
  const login = await request(c, "auth/login", "POST", {
    email: manager.email,
    password: manager.password,
  });
  c.cookie = login.headers.get("set-cookie")!.split(";")[0];
  c.csrf = (await login.json()).csrf;
  assert.equal((await remove(c, owner.id, { code: "123456" })).status, 401);
  assert.equal(await exists(owner.id), true);
  const denied = (
    await db.query(
      "SELECT metadata FROM audit_logs WHERE actor_id=$1 AND action='ADMIN_ACCOUNT_DELETE_DENIED'",
      [manager.id],
    )
  ).rows;
  assert.equal(denied.length, 1);
  assert.deepEqual(denied[0].metadata, { reason: "FORBIDDEN" });
});

test("self-delete, malformed IDs, missing/unknown code fields, CSRF and nonexistent accounts fail safely", async () => {
  const actor = await account();
  const target = await account("support");
  const self = await remove(actor.client, actor.id, { code: "123456" });
  assert.equal(self.status, 409);
  assert.deepEqual(await self.json(), { error: "SELF_DELETE_FORBIDDEN" });
  assert.equal(
    (await remove(actor.client, "not-a-uuid", { code: "123456" })).status,
    400,
  );
  assert.equal((await remove(actor.client, target.id, {})).status, 400);
  assert.equal(
    (await remove(actor.client, target.id, { recoveryCode: "not-supported" }))
      .status,
    400,
  );
  assert.equal(
    (await remove(actor.client, target.id, { code: "123456", role: "owner" }))
      .status,
    400,
  );
  assert.equal(
    (
      await remove(
        actor.client,
        target.id,
        { code: "123456" },
        { "x-csrf-token": "invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await remove(
        actor.client,
        target.id,
        { code: "123456" },
        { origin: "https://attacker.example.invalid" },
      )
    ).status,
    403,
  );
  await clearRates();
  const absent = await remove(actor.client, randomUUID(), { code: "123456" });
  assert.equal(absent.status, 404);
  assert.deepEqual(await absent.json(), { error: "ADMIN_DELETE_UNAVAILABLE" });
  assert.equal(await exists(actor.id), true);
  assert.equal(await exists(target.id), true);
});

test("invalid acting-admin TOTP is rejected and repeated confirmation attempts are database-rate-limited", async () => {
  const actor = await account();
  const target = await account("support");
  await fresh(actor.id, async (code) => {
    const bad = code === "000000" ? "999999" : "000000";
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await remove(actor.client, target.id, { code: bad })).status,
        401,
      );
    assert.equal((await remove(actor.client, target.id, { code })).status, 429);
  });
  assert.equal(await exists(target.id), true);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) n FROM audit_logs WHERE actor_id=$1 AND action='ADMIN_ACCOUNT_DELETE_DENIED'",
          [actor.id],
        )
      ).rows[0].n,
    ),
    6,
  );
});

test("authorized deletion preserves audit/payment history, revokes all sessions and resets, and consumes only acting-admin TOTP", async () => {
  const actor = await account();
  const target = await account("support");
  const second = await auth(target.email, target.password);
  const pending = await client();
  const login = await request(pending, "auth/login", "POST", {
    email: target.email,
    password: target.password,
  });
  pending.cookie = login.headers.get("set-cookie")!.split(";")[0];
  pending.csrf = (await login.json()).csrf;
  await db.query(
    "UPDATE sessions SET enrollment_ciphertext='fixture-only' WHERE pending_admin_id=$1",
    [target.id],
  );
  await db.query(
    "INSERT INTO password_resets(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [randomBytes(32).toString("hex"), target.id],
  );
  const sessionIds = (
    await db.query(
      "SELECT id FROM sessions WHERE admin_id=$1 OR pending_admin_id=$1",
      [target.id],
    )
  ).rows.map((x) => x.id);
  const history = (
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,entity,metadata) VALUES($1,'payment.confirm','orders','{\"historical\":true}') RETURNING *",
      [target.id],
    )
  ).rows[0];
  const customerId = (
    await db.query(
      "INSERT INTO customers(name,email,mobile) VALUES('Fixture','buyer@example.invalid','01000000000') RETURNING id",
    )
  ).rows[0].id;
  const addressId = (
    await db.query(
      "INSERT INTO addresses(customer_id,governorate,city,street) VALUES($1,'Test','Test','Test') RETURNING id",
      [customerId],
    )
  ).rows[0].id;
  const orderId = (
    await db.query(
      `INSERT INTO orders(reference,session_id,customer_id,address_id,tracking_hash,idempotency_key,request_hash,status,payment_method,subtotal,discount,shipping,total)
    VALUES($1,$2,$3,$4,$5,$6,'fixture','pending','cod',10000,0,0,10000) RETURNING id`,
      [
        randomUUID(),
        sessionIds[0],
        customerId,
        addressId,
        randomBytes(32).toString("hex"),
        randomUUID(),
      ],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO payments(order_id,amount,verified_by) VALUES($1,10000,$2)",
    [orderId, target.id],
  );
  await db.query("INSERT INTO shipments(order_id) VALUES($1)", [orderId]);
  const ciphertext = (
    await db.query("SELECT totp_ciphertext FROM admin_users WHERE id=$1", [
      actor.id,
    ])
  ).rows[0].totp_ciphertext;
  let usedCode = "";
  await fresh(actor.id, async (code) => {
    usedCode = code;
    assert.equal((await remove(actor.client, target.id, { code })).status, 200);
  });
  assert.equal(await exists(target.id), false);
  assert.deepEqual(
    (await db.query("SELECT * FROM audit_logs WHERE id=$1", [history.id]))
      .rows[0],
    history,
  );
  const identity = (
    await db.query("SELECT * FROM admin_identities WHERE id=$1", [target.id])
  ).rows[0];
  assert.equal(identity.email, target.email);
  assert.equal(identity.role_id, "support");
  assert.ok(identity.deleted_at);
  assert.equal(
    (
      await db.query("SELECT verified_by FROM payments WHERE order_id=$1", [
        orderId,
      ])
    ).rows[0].verified_by,
    target.id,
  );
  assert.equal(
    (await (await request(actor.client, `admin/orders/${orderId}`)).json())
      .payment_verified_by,
    target.email,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM password_resets WHERE admin_id=$1",
        [target.id],
      )
    ).rows[0].n,
    0,
  );
  const sessions = (
    await db.query("SELECT * FROM sessions WHERE id=ANY($1::uuid[])", [
      sessionIds,
    ])
  ).rows;
  assert.ok(
    sessions.every(
      (s) =>
        !s.admin_id &&
        !s.pending_admin_id &&
        !s.enrollment_ciphertext &&
        !s.mfa_verified_at &&
        new Date(s.expires_at) <= new Date(identity.deleted_at),
    ),
  );
  for (const c of [target.client, second, pending])
    assert.equal((await request(c, "admin/dashboard")).status, 401);
  assert.equal(
    (
      await request(await client(), "auth/login", "POST", {
        email: target.email,
        password: target.password,
      })
    ).status,
    401,
  );
  const event = (
    await db.query(
      "SELECT * FROM audit_logs WHERE action='ADMIN_ACCOUNT_DELETED' AND entity_id=$1",
      [target.id],
    )
  ).rows;
  assert.equal(event.length, 1);
  assert.equal(event[0].actor_id, actor.id);
  assert.equal(event[0].metadata.deletedAdminEmail, target.email);
  assert.doesNotMatch(
    JSON.stringify(event),
    /totp_ciphertext|password_hash|token_hash|\"code\"/,
  );
  assert.equal(
    (
      await db.query("SELECT totp_ciphertext FROM admin_users WHERE id=$1", [
        actor.id,
      ])
    ).rows[0].totp_ciphertext,
    ciphertext,
  );
  const other = await account("support");
  assert.equal(
    (await remove(actor.client, other.id, { code: usedCode })).status,
    401,
  );
  assert.equal(
    (await remove(actor.client, target.id, { code: usedCode })).status,
    404,
  );
});

test("permission-based last-manager guard recognizes custom roles, excludes inactive managers, and rolls back", async () => {
  await db.query(
    "INSERT INTO roles(id,permissions) VALUES('custom-control',ARRAY['users'])",
  );
  const actor = await account("custom-control");
  await assert.rejects(
    transaction(async (db) => {
      await db.query("UPDATE admin_users SET active=false WHERE id<>$1", [
        actor.id,
      ]);
      await protectLastManager(db, actor.id);
    }),
    { code: "LAST_ADMIN_FORBIDDEN" },
  );
  const target = await account("support");
  await fresh(actor.id, async (code) =>
    assert.equal((await remove(actor.client, target.id, { code })).status, 200),
  );
});

test("failed audit insert rolls back deletion, session revocation and TOTP consumption", async () => {
  const actor = await account();
  const target = await account("support");
  const before = (
    await db.query("SELECT totp_last_counter FROM admin_users WHERE id=$1", [
      actor.id,
    ])
  ).rows[0].totp_last_counter;
  await db.query(
    "ALTER TABLE audit_logs ADD CONSTRAINT fixture_reject_deletion CHECK(action<>'ADMIN_ACCOUNT_DELETED') NOT VALID",
  );
  try {
    await fresh(actor.id, async (code) =>
      assert.equal(
        (await remove(actor.client, target.id, { code })).status,
        500,
      ),
    );
  } finally {
    await db.query(
      "ALTER TABLE audit_logs DROP CONSTRAINT fixture_reject_deletion",
    );
  }
  assert.equal(await exists(target.id), true);
  assert.equal((await request(target.client, "admin/dashboard")).status, 200);
  assert.equal(
    (
      await db.query("SELECT totp_last_counter FROM admin_users WHERE id=$1", [
        actor.id,
      ])
    ).rows[0].totp_last_counter,
    before,
  );
  assert.equal(
    (
      await db.query("SELECT deleted_at FROM admin_identities WHERE id=$1", [
        target.id,
      ])
    ).rows[0].deleted_at,
    null,
  );
});

test("runtime grants allow admin removal but forbid historical identity and audit mutation", async () => {
  const actor = await account();
  const target = await account("support");
  await db.query("CREATE ROLE solea_app");
  await import("../scripts/grants");
  await db.query("SET ROLE solea_app");
  try {
    for (const sql of [
      "DELETE FROM admin_identities",
      "UPDATE admin_identities SET email=email",
      "INSERT INTO admin_identities(id,email,role_id) VALUES(gen_random_uuid(),'bad','owner')",
      "DELETE FROM audit_logs",
      "UPDATE audit_logs SET action=action",
      "CREATE TABLE not_allowed(id int)",
    ])
      await assert.rejects(() => db.query(sql));
    await fresh(actor.id, async (code) =>
      assert.equal(
        (await remove(actor.client, target.id, { code })).status,
        200,
      ),
    );
    assert.equal(await exists(target.id), false);
    assert.equal(
      (
        await db.query("SELECT email FROM admin_identities WHERE id=$1", [
          target.id,
        ])
      ).rows[0].email,
      target.email,
    );
  } finally {
    await db.query("RESET ROLE");
  }
});

test("migration 009 preserves existing TOTP ciphertext and audit rows while introducing durable identities", async () => {
  const upgrade = new PGlite();
  try {
    for (const file of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql") && f < "009")
      .sort())
      await upgrade.exec(await readFile("migrations/" + file, "utf8"));
    const id = randomUUID();
    const { encryptMfa } = await import("../src/server/totp");
    const secret = randomBytes(20),
      encrypted = encryptMfa(secret, id);
    await upgrade.query(
      "INSERT INTO admin_users(id,email,password_hash,role_id,totp_enabled,totp_ciphertext,totp_last_counter) VALUES($1,'upgrade@example.invalid','fixture','owner',true,$2,123)",
      [id, encrypted],
    );
    await upgrade.query(
      "INSERT INTO audit_logs(actor_id,action,entity) VALUES($1,'historical','admin_users')",
      [id],
    );
    const before = (await upgrade.query("SELECT * FROM audit_logs")).rows;
    await upgrade.exec(
      await readFile(
        "migrations/009_secure_admin_account_deletion.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (await upgrade.query("SELECT * FROM audit_logs")).rows,
      before,
    );
    const row = (
      await upgrade.query<{
        totp_ciphertext: string;
        totp_enabled: boolean;
        totp_last_counter: number;
      }>(
        "SELECT totp_ciphertext,totp_enabled,totp_last_counter FROM admin_users WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.totp_ciphertext, encrypted);
    assert.equal(row.totp_enabled, true);
    assert.equal(Number(row.totp_last_counter), 123);
    assert.deepEqual(decryptMfa(row.totp_ciphertext, id), secret);
    assert.equal(
      (await upgrade.query("SELECT id FROM admin_identities WHERE id=$1", [id]))
        .rows.length,
      1,
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='admin_users' AND column_name='recovery_hashes'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await upgrade.close();
  }
});

test("the target administrator's authenticator cannot authorize deletion", async () => {
  const actor = await account();
  const target = await account("support");
  await fresh(actor.id, async (actorCode) => {
    const actorRow = (
      await db.query("SELECT totp_ciphertext FROM admin_users WHERE id=$1", [
        actor.id,
      ])
    ).rows[0];
    const actorSecret = decryptMfa(actorRow.totp_ciphertext, actor.id);
    const counter = Math.floor(Date.now() / 30000);
    const actorCodes = new Set(
      [-1, 0, 1].map((offset) => totpCode(actorSecret, counter + offset)),
    );
    let targetSecret: Buffer;
    let targetCode: string;
    do {
      targetSecret = randomBytes(20);
      targetCode = totpCode(targetSecret, counter);
    } while (actorCodes.has(targetCode));
    await db.query("UPDATE admin_users SET totp_ciphertext=$1 WHERE id=$2", [
      encryptMfa(targetSecret, target.id),
      target.id,
    ]);
    assert.equal(
      (await remove(actor.client, target.id, { code: targetCode })).status,
      401,
    );
    assert.equal(await exists(target.id), true);
    assert.equal(
      (await remove(actor.client, target.id, { code: actorCode })).status,
      200,
    );
  });
});
