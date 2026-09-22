import { pool, transaction } from "../src/server/db";
const statements = `
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO solea_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO solea_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO solea_app;
REVOKE ALL ON migrations FROM solea_app;
REVOKE INSERT,UPDATE,DELETE ON roles FROM solea_app;
REVOKE UPDATE,DELETE ON audit_logs FROM solea_app;
REVOKE DELETE ON products,orders,order_items,payments,shipments,customers,addresses FROM solea_app;
`;
await transaction(async (db) => {
  for (const statement of statements.split(";").filter((x) => x.trim()))
    await db.query(statement);
});
await pool.end();
console.log("Application role privileges applied.");
