import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir("var", { recursive: true });
const password = randomBytes(24).toString("hex");
const db = new EmbeddedPostgres({
  databaseDir: "./var/test-postgres",
  user: "test_admin",
  password,
  port: 55439,
  persistent: false,
  authMethod: "scram-sha-256",
  createPostgresUser: process.getuid?.() === 0,
  onLog: () => {},
  onError: () => {},
});
await db.initialise();
await db.start();
await db.createDatabase("solea_test");
const env = {
  DATABASE_URL:
    "postgresql://test_admin:" + password + "@127.0.0.1:55439/solea_test",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  NODE_ENV: "development" as const,
  MEDIA_DIR: "./var/test-media",
  PAYMENT_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  BOSTA_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
};
await writeFile(
  "var/test.env",
  Object.entries(env)
    .map(([k, v]) => k + "=" + v)
    .join("\n") + "\n",
  { mode: 0o600 },
);
for (const script of ["db:migrate", "db:seed"]) {
  const p = spawnSync("npm", ["run", script], {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (p.status) throw new Error("Setup failed");
}
console.log(
  "Local test PostgreSQL ready on 55439. Environment stored in ignored var/test.env.",
);
process.on("SIGTERM", async () => {
  await db.stop();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await db.stop();
  process.exit(0);
});
await new Promise(() => {});
