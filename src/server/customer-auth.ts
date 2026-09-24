import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { pool, transaction, audit } from "./db";
import {
  hash,
  newSession,
  rate,
  session,
  token,
} from "./security";
import { AppError, requireCondition } from "./config";

export type CustomerAccount = {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string | null;
};

async function moveCart(oldId: string | undefined, nextId: string) {
  if (!oldId) return;
  await pool.query(
    "UPDATE carts SET session_id=$1,updated_at=now() WHERE session_id=$2 AND NOT EXISTS(SELECT 1 FROM carts WHERE session_id=$1)",
    [nextId, oldId],
  );
}

export async function customer(req: NextRequest) {
  const s = await session(req);
  requireCondition(s?.customer_account_id, 401, "CUSTOMER_LOGIN_REQUIRED");
  const account = (
    await pool.query(
      "SELECT id,name,first_name,last_name,email,mobile FROM customer_accounts WHERE id=$1 AND active=true",
      [s.customer_account_id],
    )
  ).rows[0] as CustomerAccount | undefined;
  requireCondition(account, 401, "CUSTOMER_LOGIN_REQUIRED");
  return { s, account };
}

export async function registerCustomer(
  req: NextRequest,
  data: { firstName: string; lastName: string; email: string; password: string; mobile: string },
) {
  await rate(req, "customer-register", 5, 3600);
  const passwordHash = await bcrypt.hash(data.password, 14);
  const old = await session(req);
  const account = (
    await pool.query(
      `INSERT INTO customer_accounts(name,first_name,last_name,email,mobile,password_hash)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,name,first_name,last_name,email,mobile`,
      [
        `${data.firstName} ${data.lastName}`,
        data.firstName,
        data.lastName,
        data.email,
        data.mobile,
        passwordHash,
      ],
    )
  ).rows[0] as CustomerAccount;
  const next = await newSession(null, account.id);
  await transaction(async (db) => {
    if (old)
      await db.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [old.id]);
    await audit(db, null, "customer.register", "customer_accounts", account.id);
  });
  await moveCart(old?.id, next.id);
  return { next, account };
}

export async function loginCustomer(
  req: NextRequest,
  email: string,
  password: string,
) {
  await rate(req, "customer-login-ip", 30, 900);
  await rate(req, "customer-login-account", 5, 900, email);
  const row = (
    await pool.query("SELECT * FROM customer_accounts WHERE email=$1", [email])
  ).rows[0];
  const dummy = "$2b$14$5CJkilvtoDVz1QcOV6SGmucS1EkShiHy4JDrnGXrODBjiyErBvynG";
  const valid = await bcrypt.compare(password, row?.password_hash || dummy);
  if (!valid || !row?.active) {
    await audit(pool, null, "customer.login-failed", "auth", null, {
      account: hash(email),
    });
    throw new AppError(401, "INVALID_CUSTOMER_LOGIN");
  }
  const old = await session(req);
  const next = await newSession(null, row.id);
  await transaction(async (db) => {
    if (old)
      await db.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [old.id]);
    await audit(db, null, "customer.login", "customer_accounts", row.id);
  });
  await moveCart(old?.id, next.id);
  return {
    next,
    account: {
      id: row.id,
      name: row.name,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      mobile: row.mobile,
    } as CustomerAccount,
  };
}

export async function logoutCustomer(req: NextRequest) {
  const { s } = await customer(req);
  const next = await newSession();
  await pool.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [s.id]);
  await moveCart(s.id, next.id);
  return next;
}

export async function changeCustomerPassword(
  req: NextRequest,
  currentPassword: string,
  newPassword: string,
) {
  const { s, account } = await customer(req);
  await rate(req, "customer-password", 5, 3600, account.id);
  const row = (
    await pool.query("SELECT password_hash FROM customer_accounts WHERE id=$1", [account.id])
  ).rows[0];
  requireCondition(
    await bcrypt.compare(currentPassword, row.password_hash),
    400,
    "CURRENT_PASSWORD_INVALID",
  );
  const passwordHash = await bcrypt.hash(newPassword, 14);
  const next = await newSession(null, account.id);
  await transaction(async (db) => {
    await db.query(
      "UPDATE customer_accounts SET password_hash=$1,updated_at=now() WHERE id=$2",
      [passwordHash, account.id],
    );
    await db.query(
      "UPDATE sessions SET expires_at=now() WHERE customer_account_id=$1 AND id<>$2",
      [account.id, next.id],
    );
    await db.query("UPDATE sessions SET expires_at=now() WHERE id=$1", [s.id]);
    await audit(db, null, "customer.password-changed", "customer_accounts", account.id);
  });
  await moveCart(s.id, next.id);
  return next;
}

export async function createCustomerReset(email: string) {
  const account = (
    await pool.query("SELECT id,email FROM customer_accounts WHERE email=$1 AND active=true", [email])
  ).rows[0];
  if (!account) return null;
  const raw = token();
  await transaction(async (db) => {
    await db.query(
      "UPDATE customer_password_resets SET used_at=now() WHERE account_id=$1 AND used_at IS NULL",
      [account.id],
    );
    await db.query(
      "INSERT INTO customer_password_resets(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
      [hash(raw), account.id],
    );
  });
  return { raw, account };
}

export async function resetCustomerPassword(raw: string, password: string) {
  return transaction(async (db) => {
    const reset = (
      await db.query(
        "SELECT * FROM customer_password_resets WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE",
        [hash(raw)],
      )
    ).rows[0];
    requireCondition(reset, 400, "INVALID_RESET");
    await db.query(
      "UPDATE customer_accounts SET password_hash=$1,updated_at=now() WHERE id=$2",
      [await bcrypt.hash(password, 14), reset.account_id],
    );
    await db.query(
      "UPDATE customer_password_resets SET used_at=now() WHERE account_id=$1 AND used_at IS NULL",
      [reset.account_id],
    );
    await db.query(
      "UPDATE sessions SET expires_at=now() WHERE customer_account_id=$1",
      [reset.account_id],
    );
    await audit(db, null, "customer.password-reset", "customer_accounts", reset.account_id);
    return { ok: true };
  });
}
