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
const e = email.parse(
  process.env.ADMIN_EMAIL || (await rl.question("Admin email: ")),
);
let entered = process.env.ADMIN_PASSWORD;
if (!entered) {
  process.stdout.write("Password (hidden): ");
  muted = true;
  entered = await rl.question("");
  muted = false;
  process.stdout.write("\n");
}
const p = password.parse(entered);
rl.close();
const result = await pool.query(
  "INSERT INTO admin_users(email,password_hash,role_id) VALUES($1,$2,'owner') RETURNING id",
  [e, await bcrypt.hash(p, 12)],
);
await audit(
  pool,
  result.rows[0].id,
  "admin.bootstrap",
  "admin_users",
  result.rows[0].id,
);
await pool.end();
console.log("Administrator created. No password is stored in source.");
