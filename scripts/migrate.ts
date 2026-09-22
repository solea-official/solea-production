import { readFile, readdir } from "node:fs/promises";
if (process.env.DIRECT_DATABASE_URL)
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
const { pool, transaction } = await import("../src/server/db");
await transaction(async (db) => {
  await db.query("SELECT pg_advisory_xact_lock(903171)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT 1 FROM migrations WHERE name=$1", [file]))
        .rowCount
    )
      continue;
    await db.query(await readFile("migrations/" + file, "utf8"));
    await db.query("INSERT INTO migrations(name) VALUES($1)", [file]);
    console.log("Applied", file);
  }
});
await pool.end();
