import { pool, transaction } from "../src/server/db";
import { releaseStock } from "../src/server/commerce";
import { adapter, sendEmail } from "../src/server/integrations";
import { sign } from "../src/server/security";
import { z } from "zod";
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  await transaction(async (db) => {
    const expired = (
      await db.query(
        "SELECT * FROM orders WHERE status='pending' AND payment_method='card' AND expires_at<now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 30",
      )
    ).rows;
    for (const o of expired) {
      await releaseStock(db, o);
      await db.query(
        "UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",
        [o.id],
      );
    }
  });
  const job = await transaction(async (db) => {
    const r = (
      await db.query(
        "SELECT * FROM outbox WHERE (status IN ('pending','failed') AND attempts<8 AND next_at<=now()) OR (status='working' AND next_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (r)
      await db.query(
        "UPDATE outbox SET status='working',attempts=attempts+1,next_at=now()+interval '2 minutes' WHERE id=$1",
        [r.id],
      );
    return r;
  });
  if (job) {
    try {
      const o = (
        await pool.query(
          "SELECT o.*,c.email,c.name,c.mobile,a.governorate,a.city,a.street,a.building,a.floor,a.apartment,p.provider_id payment_provider FROM orders o JOIN customers c ON c.id=o.customer_id JOIN addresses a ON a.id=o.address_id JOIN payments p ON p.order_id=o.id WHERE o.id=$1",
          [job.order_id],
        )
      ).rows[0];
      if (job.kind === "ship") {
        if (o.status !== "processing") throw new Error("INVALID_TRANSITION");
        const r = z
          .object({
            providerId: z.string().max(150),
            trackingId: z.string().max(150),
          })
          .parse(
            await adapter(
              "BOSTA",
              "shipments",
              {
                orderId: o.id,
                reference: o.reference,
                receiver: { name: o.name, mobile: o.mobile },
                address: {
                  governorate: o.governorate,
                  city: o.city,
                  street: o.street,
                  building: o.building,
                  floor: o.floor,
                  apartment: o.apartment,
                },
                codAmount: o.payment_method === "cod" ? o.total : 0,
                currency: o.currency,
              },
              job.dedupe_key,
            ),
          );
        await pool.query(
          "UPDATE shipments SET provider_id=$1,tracking_id=$2,updated_at=now() WHERE order_id=$3",
          [r.providerId, r.trackingId, o.id],
        );
      } else if (job.kind === "refund") {
        await adapter(
          "PAYMENT",
          "refund",
          {
            orderId: o.id,
            providerId: o.payment_provider,
            amount: o.total,
            currency: o.currency,
          },
          job.dedupe_key,
        );
      } else {
        await sendEmail(
          o.email,
          "SOLÉA — " + o.reference,
          "SOLÉA\n" +
            o.reference +
            "\nStatus: " +
            o.status +
            "\nTracking key: " +
            sign("tracking:" + o.id) +
            "\nTrack securely at " +
            process.env.APP_URL +
            "/track-order",
          job.dedupe_key + ":customer",
        );
        if (job.kind === "order-email" && process.env.ADMIN_NOTIFICATION_EMAIL)
          await sendEmail(
            process.env.ADMIN_NOTIFICATION_EMAIL,
            "SOLÉA — New order",
            o.reference + "\n" + process.env.APP_URL + "/admin/orders",
            job.dedupe_key + ":admin",
          );
      }
      await pool.query(
        "UPDATE outbox SET status='done',last_error=NULL,payload='{}' WHERE id=$1",
        [job.id],
      );
    } catch {
      await pool.query(
        "UPDATE outbox SET status='failed',last_error='PROVIDER_UNAVAILABLE',next_at=now()+interval '5 minutes' WHERE id=$1",
        [job.id],
      );
    }
  } else await new Promise((r) => setTimeout(r, 1500));
  await pool.query("DELETE FROM rate_limits WHERE expires_at<now()");
  await pool.query("DELETE FROM password_resets WHERE expires_at<now()");
}
await pool.end();
