import { NextRequest } from "next/server";
import { z } from "zod";
import { pool, transaction, audit } from "./db";
import { customer } from "./customer-auth";
import { requireCondition } from "./config";
import { hash } from "./security";
import { savedAddressSchema, uuid } from "./validation";

export async function customerApi(
  req: NextRequest,
  parts: string[],
  body: () => Promise<unknown>,
) {
  const { account } = await customer(req);
  const resource = parts[1];
  const id = parts[2];
  const method = req.method;

  if (resource === "me") {
    requireCondition(method === "GET", 405, "METHOD_NOT_ALLOWED");
    const metrics = (
      await pool.query(
        `SELECT count(*)::int orders,
         COALESCE(sum((SELECT sum(quantity) FROM order_items WHERE order_id=o.id)),0)::int units
         FROM orders o WHERE account_id=$1`,
        [account.id],
      )
    ).rows[0];
    return { ...account, metrics };
  }

  if (resource === "profile") {
    requireCondition(method === "PUT", 405, "METHOD_NOT_ALLOWED");
    const data = z
      .object({
        name: z.string().trim().min(1).max(150),
        mobile: z.union([z.string().regex(/^01[0125][0-9]{8}$/), z.literal("")]),
      })
      .strict()
      .parse(await body());
    await pool.query(
      "UPDATE customer_accounts SET name=$1,mobile=$2,updated_at=now() WHERE id=$3",
      [data.name, data.mobile || null, account.id],
    );
    await audit(pool, null, "customer.profile-updated", "customer_accounts", account.id);
    return { ok: true };
  }

  if (resource === "addresses") {
    if (id) uuid.parse(id);
    if (method === "GET")
      return (
        await pool.query(
          "SELECT * FROM saved_addresses WHERE account_id=$1 ORDER BY is_default DESC,created_at DESC",
          [account.id],
        )
      ).rows;
    if (method === "POST" || method === "PUT") {
      const data = savedAddressSchema.parse(await body());
      return transaction(async (db) => {
        const currentCount = (
          await db.query("SELECT count(*)::int n FROM saved_addresses WHERE account_id=$1", [
            account.id,
          ])
        ).rows[0].n;
        requireCondition(method === "PUT" || currentCount < 20, 409, "ADDRESS_LIMIT");
        const makeDefault = data.is_default || currentCount === 0;
        if (makeDefault)
          await db.query("UPDATE saved_addresses SET is_default=false WHERE account_id=$1", [
            account.id,
          ]);
        const values = [
          data.label,
          data.full_name,
          data.mobile,
          data.governorate,
          data.city,
          data.street,
          data.building,
          data.floor,
          data.apartment,
          data.notes,
          makeDefault,
        ];
        const row = method === "POST"
          ? (
              await db.query(
                `INSERT INTO saved_addresses(account_id,label,full_name,mobile,governorate,city,street,building,floor,apartment,notes,is_default)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
                [account.id, ...values],
              )
            ).rows[0]
          : (
              await db.query(
                `UPDATE saved_addresses SET label=$1,full_name=$2,mobile=$3,governorate=$4,city=$5,street=$6,building=$7,
                 floor=$8,apartment=$9,notes=$10,is_default=$11,updated_at=now()
                 WHERE id=$12 AND account_id=$13 RETURNING *`,
                [...values, id, account.id],
              )
            ).rows[0];
        requireCondition(row, 404, "ADDRESS_NOT_FOUND");
        await audit(db, null, method === "POST" ? "address.created" : "address.updated", "saved_addresses", row.id, {
          accountId: account.id,
        });
        return row;
      });
    }
    if (method === "DELETE") {
      return transaction(async (db) => {
        const deleted = (
          await db.query(
            "DELETE FROM saved_addresses WHERE id=$1 AND account_id=$2 RETURNING id,is_default",
            [id, account.id],
          )
        ).rows[0];
        requireCondition(deleted, 404, "ADDRESS_NOT_FOUND");
        if (deleted.is_default)
          await db.query(
            `UPDATE saved_addresses SET is_default=true WHERE id=(
               SELECT id FROM saved_addresses WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1
             )`,
            [account.id],
          );
        await audit(db, null, "address.deleted", "saved_addresses", id, {
          accountId: account.id,
        });
        return { ok: true };
      });
    }
    requireCondition(false, 405, "METHOD_NOT_ALLOWED");
  }

  if (resource === "orders") {
    requireCondition(method === "GET", 405, "METHOD_NOT_ALLOWED");
    if (!id)
      return (
        await pool.query(
          `SELECT o.id,o.reference,o.status,o.payment_method,o.total,o.created_at,
           p.status payment_status,
           (SELECT count(*)::int FROM order_items WHERE order_id=o.id) item_count,
           (SELECT COALESCE(sum(quantity),0)::int FROM order_items WHERE order_id=o.id) units
           FROM orders o JOIN payments p ON p.order_id=o.id
           WHERE o.account_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
          [account.id],
        )
      ).rows;
    uuid.parse(id);
    const order = (
      await pool.query(
        `SELECT o.id,o.reference,o.status,o.payment_method,o.subtotal,o.discount,o.shipping,o.total,o.created_at,
         p.status payment_status,p.transfer_reference,(p.proof_storage_path IS NOT NULL) proof_uploaded,
         a.governorate,a.city,a.street,a.building,a.floor,a.apartment,
         s.status shipping_status,s.tracking_id
         FROM orders o JOIN payments p ON p.order_id=o.id
         JOIN addresses a ON a.id=o.address_id JOIN shipments s ON s.order_id=o.id
         WHERE o.id=$1 AND o.account_id=$2`,
        [id, account.id],
      )
    ).rows[0];
    requireCondition(order, 404, "ORDER_NOT_FOUND");
    return {
      ...order,
      items: (
        await pool.query(
          "SELECT name_en,name_ar,quantity,unit_price FROM order_items WHERE order_id=$1 ORDER BY id",
          [id],
        )
      ).rows,
    };
  }

  if (resource === "claim") {
    requireCondition(method === "POST", 405, "METHOD_NOT_ALLOWED");
    const data = z
      .object({
        reference: z.string().regex(/^SOL-[A-F0-9]{16}$/),
        trackingKey: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(await body());
    return transaction(async (db) => {
      const order = (
        await db.query("SELECT id,account_id,tracking_hash FROM orders WHERE reference=$1 FOR UPDATE", [
          data.reference,
        ])
      ).rows[0];
      requireCondition(
        order && order.tracking_hash === hash(data.trackingKey),
        404,
        "CLAIM_INVALID",
      );
      requireCondition(order.account_id !== account.id, 409, "ORDER_ALREADY_CLAIMED");
      requireCondition(!order.account_id, 409, "ORDER_CLAIM_UNAVAILABLE");
      await db.query("UPDATE orders SET account_id=$1,updated_at=now() WHERE id=$2", [
        account.id,
        order.id,
      ]);
      await audit(db, null, "order.claimed", "orders", order.id, {
        accountId: account.id,
      });
      return { ok: true, id: order.id };
    });
  }

  requireCondition(false, 404, "NOT_FOUND");
}
