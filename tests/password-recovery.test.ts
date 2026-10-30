import { test, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { NextRequest } from "next/server";
import {
  db,
  engine,
  request,
  client,
  customerClient,
  clearRates,
  auth,
} from "./helpers";
const { queueRecovery, processRecoveryJob } =
  await import("../src/server/password-recovery");
const { emailConfiguration, safeEmailFailure, verifyEmailTransport } =
  await import("../src/server/email");
const { hash } = await import("../src/server/security");
const { proxy } = await import("../src/proxy");

const messages: Mail.Options[] = [];
let failure: Error | undefined;
let verifies = 0;
const smtp = mock.method(
  nodemailer,
  "createTransport",
  (options: SMTPTransport.Options) => {
    assert.equal(options.tls?.rejectUnauthorized, true);
    assert.equal(options.requireTLS, true);
    assert.equal(options.debug, false);
    assert.equal(options.logger, false);
    assert.equal(options.disableFileAccess, true);
    assert.equal(options.disableUrlAccess, true);
    return {
      close() {},
      async verify() {
        verifies++;
        if (failure) throw failure;
        return true;
      },
      async sendMail(message: Mail.Options) {
        if (failure) throw failure;
        messages.push(message);
        return { accepted: [message.to], rejected: [] };
      },
    };
  },
);
beforeEach(async () => {
  Object.assign(process.env, {
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "smtp",
    EMAIL_DOMAIN_VERIFIED: "true",
    EMAIL_FROM: "SOLÉA Support <support@example.invalid>",
    SMTP_HOST: "smtp.example.invalid",
    SMTP_PORT: "465",
    SMTP_USER: "test-user",
    SMTP_PASSWORD: randomBytes(24).toString("hex"),
  });
  failure = undefined;
  messages.length = 0;
  await clearRates();
  await db.query("DELETE FROM outbox WHERE kind='password-reset-email'");
});
after(async () => {
  smtp.mock.restore();
  await engine.close();
});
const rawFrom = (message: Mail.Options) => {
  const value = String(message.text).match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(value, "Email contains a generated fragment credential");
  return value;
};
const freshPassword = () => "Strong9" + randomBytes(12).toString("hex");

test("unconfigured or disabled recovery fails visibly and identically for existing and unknown emails", async () => {
  await customerClient("configured@example.invalid");
  const c = await client();
  process.env.EMAIL_ENABLED = "false";
  for (const path of ["account/reset-request", "auth/reset-request"]) {
    for (const email of [
      "configured@example.invalid",
      "missing@example.invalid",
    ]) {
      const r = await request(c, path, "POST", { email });
      assert.equal(r.status, 503);
      assert.deepEqual(await r.json(), { error: "EMAIL_UNAVAILABLE" });
    }
  }
  assert.equal(messages.length, 0);
});

test("customer requests queue email to the registered address without domain restrictions; unknown accounts get identical responses", async () => {
  const c = await client();
  for (const domain of [
    "gmail.com",
    "outlook.com",
    "yahoo.com",
    "hotmail.com",
    "custom.example.invalid",
  ]) {
    await clearRates();
    const email = `fixture-${randomUUID()}@${domain}`;
    await customerClient(email);
    const r = await request(c, "account/reset-request", "POST", {
      email: email.toUpperCase(),
      locale: "ar",
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const job = (
      await db.query(
        "SELECT * FROM outbox WHERE status='pending' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    assert.deepEqual(Object.keys(job.payload).sort(), [
      "accountId",
      "audience",
      "locale",
    ]);
    assert.equal(messages.length, 0);
    await processRecoveryJob(job.id);
    assert.equal(messages[0].to, email);
    assert.match(String(messages[0].html), /lang="ar" dir="rtl"/);
    assert.ok(String(messages[0].text).includes("/account/reset#token="));
    const token = rawFrom(messages[0]);
    const stored = (
      await db.query(
        "SELECT token_hash FROM customer_password_resets WHERE token_hash=$1",
        [hash(token)],
      )
    ).rows[0];
    assert.ok(stored && stored.token_hash !== token);
    messages.length = 0;
  }
  await clearRates();
  const unknown = await request(c, "account/reset-request", "POST", {
    email: "unknown@example.invalid",
  });
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), { ok: true });
  await processRecoveryJob();
  assert.equal(messages.length, 0);
});

test("customer email token resets password, revokes sessions, keeps identity, and cannot be reused", async () => {
  const email = "customer-reset@example.invalid",
    oldPassword = freshPassword();
  const logged = await customerClient(email);
  const account = (
    await db.query("SELECT id FROM customer_accounts WHERE email=$1", [email])
  ).rows[0];
  await db.query("UPDATE customer_accounts SET password_hash=$1 WHERE id=$2", [
    await bcrypt.hash(oldPassword, 4),
    account.id,
  ]);
  const id = await queueRecovery("customer", email, "en");
  await processRecoveryJob(id);
  const value = rawFrom(messages[0]);
  const anon = await client(),
    next = freshPassword();
  assert.equal(
    (
      await request(anon, "account/reset", "POST", {
        token: value,
        password: next,
      })
    ).status,
    200,
  );
  assert.equal((await request(logged, "account/me")).status, 401);
  const row = (
    await db.query("SELECT * FROM customer_accounts WHERE id=$1", [account.id])
  ).rows[0];
  assert.equal(row.email, email);
  assert.equal(bcrypt.getRounds(row.password_hash), 14);
  assert.ok(await bcrypt.compare(next, row.password_hash));
  assert.ok(!(await bcrypt.compare(oldPassword, row.password_hash)));
  assert.equal(
    (
      await request(anon, "account/reset", "POST", {
        token: value,
        password: next,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(anon, "account/login", "POST", {
        email,
        password: oldPassword,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request(anon, "account/login", "POST", { email, password: next }))
      .status,
    200,
  );
});

test("admin recovery preserves role, revokes sessions and requires fresh password login; customer token cannot reset admin", async () => {
  const email = "admin-reset@example.invalid",
    oldPassword = freshPassword();
  const account = (
    await db.query(
      "INSERT INTO admin_users(email,password_hash,role_id) SELECT $1,$2,id FROM roles WHERE id='owner' RETURNING id,role_id",
      [email, await bcrypt.hash(oldPassword, 14)],
    )
  ).rows[0];
  const logged = await auth(email, oldPassword);
  const id = await queueRecovery("admin", email, "en");
  await processRecoveryJob(id);
  assert.ok(String(messages[0].text).includes("/ops-portal?reset=1#token="));
  const value = rawFrom(messages[0]),
    anon = await client(),
    next = freshPassword();
  assert.equal(
    (
      await request(anon, "account/reset", "POST", {
        token: value,
        password: next,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(anon, "auth/reset", "POST", {
        token: value,
        password: next,
      })
    ).status,
    200,
  );
  assert.equal((await request(logged, "admin/dashboard")).status, 401);
  const row = (
    await db.query("SELECT * FROM admin_users WHERE id=$1", [account.id])
  ).rows[0];
  assert.equal(row.role_id, account.role_id);
  assert.equal(bcrypt.getRounds(row.password_hash), 14);
  assert.equal(
    (
      await request(anon, "auth/reset", "POST", {
        token: value,
        password: next,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(anon, "auth/login", "POST", {
        email,
        password: oldPassword,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request(anon, "auth/login", "POST", { email, password: next }))
      .status,
    200,
  );
});

test("expired, malformed and inactive-account reset credentials fail and never change passwords", async () => {
  const email = "expired@example.invalid";
  await customerClient(email);
  const id = await queueRecovery("customer", email, "en");
  await processRecoveryJob(id);
  const value = rawFrom(messages[0]),
    anon = await client();
  await db.query(
    "UPDATE customer_password_resets SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [hash(value)],
  );
  for (const token of [value, "invalid", randomBytes(32).toString("hex")])
    assert.equal(
      (
        await request(anon, "account/reset", "POST", {
          token,
          password: freshPassword(),
        })
      ).status,
      400,
    );
  await db.query(
    "UPDATE customer_password_resets SET expires_at=now()+interval '10 minutes' WHERE token_hash=$1",
    [hash(value)],
  );
  await db.query("UPDATE customer_accounts SET active=false WHERE email=$1", [
    email,
  ]);
  assert.equal(
    (
      await request(anon, "account/reset", "POST", {
        token: value,
        password: freshPassword(),
      })
    ).status,
    400,
  );
});

test("SMTP failure is observable and sanitized, retry is bounded, and transport outage response cannot enumerate accounts", async () => {
  const email = "smtp-failure@example.invalid";
  await customerClient(email);
  const id = await queueRecovery("customer", email, "en");
  failure = Object.assign(
    new Error("PRIVATE SMTP RESPONSE MUST NEVER BE LOGGED"),
    { code: "EAUTH", responseCode: 535 },
  );
  await processRecoveryJob(id);
  const job = (await db.query("SELECT * FROM outbox WHERE id=$1", [id]))
    .rows[0];
  assert.equal(job.status, "failed");
  assert.equal(job.last_error, "EAUTH_535");
  assert.equal(job.attempts, 3);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM customer_password_resets r JOIN customer_accounts c ON c.id=r.account_id WHERE c.email=$1",
        [email],
      )
    ).rowCount,
    0,
  );
  const c = await client();
  for (const address of [email, "unknown@example.invalid"])
    assert.equal(
      (await request(c, "account/reset-request", "POST", { email: address }))
        .status,
      503,
    );
  assert.equal(await processRecoveryJob(id), false);
  assert.equal(
    safeEmailFailure(new Error("contains a secret")),
    "EMAIL_DELIVERY_FAILED",
  );
});

test("transient failure can retry safely, duplicate worker calls do not resend a completed job, stale requests expire", async () => {
  const email = "retry@example.invalid";
  await customerClient(email);
  const id = await queueRecovery("customer", email, "en");
  failure = Object.assign(new Error("transient"), { code: "ETIMEDOUT" });
  await processRecoveryJob(id);
  failure = undefined;
  await db.query(
    "UPDATE outbox SET next_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await Promise.all([processRecoveryJob(id), processRecoveryJob(id)]);
  assert.equal(messages.length, 1);
  assert.equal(await processRecoveryJob(id), false);
  const stale = await queueRecovery("customer", email, "en");
  await db.query(
    "UPDATE outbox SET created_at=now()-interval '31 minutes' WHERE id=$1",
    [stale],
  );
  await processRecoveryJob(stale);
  assert.equal(messages.length, 1);
  assert.equal(
    (await db.query("SELECT last_error FROM outbox WHERE id=$1", [stale]))
      .rows[0].last_error,
    "RESET_REQUEST_EXPIRED",
  );
});

test("recovery requests preserve CSRF, strict validation and database-backed per-IP and per-account throttling", async () => {
  const c = await client();
  assert.equal(
    (
      await request(null, "account/reset-request", "POST", {
        email: "unknown@example.invalid",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(c, "auth/reset-request", "POST", {
        email: "unknown@example.invalid",
        role: "owner",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(c, "account/reset-request", "POST", {
        email: "unknown@example.invalid",
        redirectTo: "https://attacker.invalid",
      })
    ).status,
    400,
  );
  await clearRates();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(c, "account/reset-request", "POST", {
          email: "unknown@example.invalid",
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await request(c, "account/reset-request", "POST", {
        email: "unknown@example.invalid",
      })
    ).status,
    429,
  );
  const count = (await db.query("SELECT count(*) n FROM rate_limits")).rows[0];
  assert.ok(Number(count.n) >= 2);
});

test("distributed recovery identity throttle applies across trusted IPs; bad CSRF is denied", async () => {
  const c = await client();
  assert.equal(
    (
      await request(
        c,
        "account/reset-request",
        "POST",
        { email: "unknown@example.invalid" },
        { "x-csrf-token": "invalid" },
      )
    ).status,
    403,
  );
  process.env.TRUST_PROXY = "true";
  try {
    for (let i = 1; i <= 5; i++)
      assert.equal(
        (
          await request(
            c,
            "auth/reset-request",
            "POST",
            { email: "distributed@example.invalid" },
            { "x-real-ip": `192.0.2.${i}` },
          )
        ).status,
        200,
      );
    assert.equal(
      (
        await request(
          c,
          "auth/reset-request",
          "POST",
          { email: "distributed@example.invalid" },
          { "x-real-ip": "192.0.2.99" },
        )
      ).status,
      429,
    );
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test("authenticated customer password change invalidates existing recovery links and keeps customer identity", async () => {
  const email = "change-password@example.invalid",
    old = freshPassword(),
    next = freshPassword();
  const c = await customerClient(email);
  await db.query(
    "UPDATE customer_accounts SET password_hash=$1 WHERE email=$2",
    [await bcrypt.hash(old, 4), email],
  );
  await processRecoveryJob(await queueRecovery("customer", email, "en"));
  const token = rawFrom(messages[0]);
  const response = await request(c, "account/change-password", "POST", {
    currentPassword: old,
    newPassword: next,
  });
  assert.equal(response.status, 200);
  const anon = await client();
  assert.equal(
    (
      await request(anon, "account/reset", "POST", {
        token,
        password: freshPassword(),
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(anon, "account/login", "POST", { email, password: next }))
      .status,
    200,
  );
});

test("recipient rejection records a safe failure without blocking unrelated accounts or leaking existence", async () => {
  await customerClient("rejected@example.invalid");
  const id = await queueRecovery("customer", "rejected@example.invalid", "en");
  failure = Object.assign(new Error("private mailbox rejection"), {
    code: "EENVELOPE",
    responseCode: 550,
  });
  await processRecoveryJob(id);
  const job = (
    await db.query(
      "SELECT status,last_error,attempts FROM outbox WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(job, {
    status: "failed",
    last_error: "EENVELOPE_550",
    attempts: 3,
  });
  const c = await client();
  for (const email of ["rejected@example.invalid", "unknown@example.invalid"])
    assert.equal(
      (await request(c, "account/reset-request", "POST", { email })).status,
      200,
    );
});

test("successful reset rotates to an anonymous session with fresh CSRF and supports immediate password login", async () => {
  const email="session-reset@example.invalid", logged=await customerClient(email);
  await processRecoveryJob(await queueRecovery("customer",email,"en"));
  const password=freshPassword();
  const reset=await request(logged,"account/reset","POST",{token:rawFrom(messages[0]),password});
  assert.equal(reset.status,200);
  const body=await reset.json();
  assert.ok(typeof body.csrf === "string");
  const fresh={cookie:reset.headers.get("set-cookie")!.split(";")[0],csrf:body.csrf};
  assert.ok(fresh.cookie !== logged.cookie);
  assert.equal((await request(fresh,"account/me")).status,401);
  assert.equal((await request(fresh,"admin/dashboard")).status,401);
  assert.equal((await request(fresh,"account/login","POST",{email,password})).status,200);
});

test("SMTP configuration requires verified sender and authenticated TLS; transport check sends no email", async () => {
  await verifyEmailTransport();
  assert.ok(verifies);
  assert.equal(messages.length, 0);
  process.env.SMTP_PORT = "587";
  const c = emailConfiguration();
  assert.equal(c.provider, "smtp");
  if (c.provider === "smtp") {
    assert.equal(c.options.secure, false);
    assert.equal(c.options.requireTLS, true);
  }
  process.env.EMAIL_DOMAIN_VERIFIED = "false";
  assert.throws(() => emailConfiguration());
});

test("recovery pages are private, noindex and no-referrer; admin remains a non-disclosing 404", async () => {
  for (const path of ["/account/reset", "/ops-portal?reset=1"]) {
    const r = await proxy(new NextRequest("http://localhost:3000" + path));
    assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
    assert.match(r.headers.get("Cache-Control") || "", /no-store/);
    assert.match(r.headers.get("X-Robots-Tag") || "", /noindex/);
  }
  const old = await proxy(new NextRequest("http://localhost:3000/admin"));
  assert.equal(old.status, 404);
  assert.equal(old.headers.get("location"), null);
});
