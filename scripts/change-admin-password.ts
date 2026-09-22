import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import bcrypt from "bcryptjs";
import { email, password } from "../src/server/validation";
import { pool, audit } from "../src/server/db";

let muted = false;

const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});

const rl = createInterface({
  input: process.stdin,
  output,
  terminal: !!process.stdin.isTTY,
});

const adminEmail = email.parse(
  await rl.question("Admin email: ")
);

process.stdout.write("New password (hidden): ");
muted = true;
const entered = await rl.question("");
muted = false;
process.stdout.write("\n");

const newPassword = password.parse(entered);

rl.close();

const passwordHash = await bcrypt.hash(newPassword, 14);

const result = await pool.query(
  `UPDATE admin_users
   SET password_hash=$1
   WHERE email=$2
   RETURNING id`,
  [passwordHash, adminEmail],
);

if (!result.rows[0]) {
  await pool.end();
  throw new Error("Administrator not found.");
}

const adminId = result.rows[0].id;

await pool.query(
  "UPDATE sessions SET expires_at=now() WHERE admin_id=$1",
  [adminId],
);

await audit(
  pool,
  adminId,
  "password.changed.cli",
  "admin_users",
  adminId,
);

await pool.end();

console.log("Administrator password updated using bcrypt cost 14.");
console.log("Existing admin sessions were invalidated.");