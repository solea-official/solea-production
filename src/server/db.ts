import { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
const globalDb = globalThis as unknown as { soleaPool?: Pool };
export const pool =
  globalDb.soleaPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(1, Math.min(5, Number(process.env.DB_POOL_MAX || 1))),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
    keepAlive: true,
  });
globalDb.soleaPool = pool;
export const orm = drizzle(pool);
export type DB = Pick<PoolClient, "query">;
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function audit(
  db: DB,
  actor: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [actor, action, entity, entityId, JSON.stringify(metadata)],
  );
}
