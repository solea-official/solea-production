// Trusted operator CLI only; never runs in a Vercel request or build.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, open, stat } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
async function main() {
  const output = process.argv[2],
    label = process.argv[3];
  if (!output || !label || label.length > 120)
    throw new Error(
      "Usage: npm run reporting:backup -- /secure/path/backup.dump backup-label",
    );
  const url = new URL(process.env.DIRECT_DATABASE_URL || "");
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "require",
  };
  const destination = path.resolve(output);
  // Refuse to overwrite an existing backup. Keep private data operator-only.
  const file = await open(destination, "wx", 0o600);
  await file.close();
  function run(command: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: "ignore" });
      child.on("error", () =>
        reject(new Error("Backup tooling unavailable; no reset authorized.")),
      );
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error("Backup verification failed; no reset authorized."),
            ),
      );
    });
  }
  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    `--file=${destination}`,
  ]);
  await chmod(destination, 0o600);
  await run("pg_restore", ["--list", destination]);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(destination)) digest.update(chunk);
  const bytes = (await stat(destination)).size;
  if (!bytes) throw new Error("Empty backup; no reset authorized.");
  const pool = new Pool({
    connectionString: process.env.DIRECT_DATABASE_URL,
    max: 1,
  });
  try {
    const receipt = (
      await pool.query(
        "INSERT INTO reporting_backups(label,sha256,bytes) VALUES($1,$2,$3) RETURNING id",
        [label, digest.digest("hex"), bytes],
      )
    ).rows[0];
    console.log(
      JSON.stringify({ backupId: receipt.id, verifiedArchive: true }),
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Backup was not registered. Check PostgreSQL tooling, private destination permissions and the operator database connection. No reset was performed.",
  );
  process.exitCode = 1;
});
