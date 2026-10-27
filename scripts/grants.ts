export {};

if (process.env.DIRECT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

const { pool, transaction } = await import("../src/server/db");

const selectTables = [
  "reporting_backups",
  "reporting_periods",
  "reporting_state",
  "manual_transfer_references",
  "roles",
  "admin_identities",
  "admin_users",
  "sessions",
  "password_resets",
  "rate_limits",
  "categories",
  "products",
  "product_images",
  "inventory",
  "customers",
  "addresses",
  "carts",
  "cart_items",
  "coupons",
  "orders",
  "order_items",
  "payments",
  "shipments",
  "webhook_events",
  "content",
  "store_settings",
  "subscribers",
  "outbox",
  "audit_logs",
  "customer_accounts",
  "saved_addresses",
  "customer_password_resets",
] as const;

const insertTables = selectTables.filter(
  (table) => !["reporting_backups", "reporting_state", "roles", "admin_identities", "store_settings"].includes(table),
);
const updateTables = selectTables.filter(
  (table) => !["reporting_backups", "reporting_periods", "manual_transfer_references", "roles", "admin_identities", "audit_logs", "categories", "order_items", "webhook_events"].includes(table),
);
const deleteTables = [
  "admin_users",
  "password_resets",
  "rate_limits",
  "product_images",
  "cart_items",
  "customer_password_resets",
  "saved_addresses",
] as const;

const policyName = (operation: string) => `solea_app_${operation}`;

await transaction(async (db) => {
  await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await db.query("GRANT USAGE ON SCHEMA public TO solea_app");
  await db.query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM solea_app");
  await db.query("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM solea_app");
  await db.query(`GRANT SELECT ON ${selectTables.join(",")} TO solea_app`);
  await db.query(`GRANT INSERT ON ${insertTables.join(",")} TO solea_app`);
  await db.query(`GRANT UPDATE ON ${updateTables.join(",")} TO solea_app`);
  await db.query(`GRANT DELETE ON ${deleteTables.join(",")} TO solea_app`);
  await db.query(
    "GRANT USAGE,SELECT ON SEQUENCE audit_logs_id_seq TO solea_app",
  );

  const policies = [
    ["select", selectTables],
    ["insert", insertTables],
    ["update", updateTables],
    ["delete", deleteTables],
  ] as const;
  for (const [operation, tables] of policies)
    for (const table of tables) {
      const name = policyName(operation);
      await db.query(`DROP POLICY IF EXISTS ${name} ON ${table}`);
      await db.query(
        operation === "insert"
          ? `CREATE POLICY ${name} ON ${table} FOR INSERT TO solea_app WITH CHECK (true)`
          : operation === "update"
            ? `CREATE POLICY ${name} ON ${table} FOR UPDATE TO solea_app USING (true) WITH CHECK (true)`
            : `CREATE POLICY ${name} ON ${table} FOR ${operation.toUpperCase()} TO solea_app USING (true)`,
      );
    }
});
await pool.end();
console.log("Application role privileges applied.");
