import { bundleDiscount } from "../lib/promotions";
import { z } from "zod";
import { pool, transaction, DB, audit } from "./db";
import { checkoutSchema } from "./validation";
import { requireCondition } from "./config";
import { Session, hash, sign } from "./security";
import { randomUUID } from "node:crypto";
import { manualPaymentSettings } from "./manual-payments";
import { createPaymobIntention, paymobSettings } from "./paymob";

type ShippingZone = {
  governorate: string;
  zone: string;
  fee: number;
  active: boolean;
};

function shippingFee(
  settings: Record<string, unknown>,
  governorate: string,
  net: number,
) {
  const zones = (settings.shipping_zones || []) as ShippingZone[];
  const rate = zones.find((r) => r.active && r.governorate === governorate);
  requireCondition(
    rate && Number.isInteger(rate.fee) && rate.fee >= 0,
    409,
    "DELIVERY_UNAVAILABLE",
  );
  const threshold = settings.free_shipping_threshold;
  return typeof threshold === "number" && threshold > 0 && net >= threshold
    ? 0
    : rate.fee;
}
export async function getCart(s: Session) {
  const c = await pool.query(
    "INSERT INTO carts(session_id) VALUES($1) ON CONFLICT(session_id) DO UPDATE SET session_id=EXCLUDED.session_id RETURNING id",
    [s.id],
  );
  const r = await pool.query(
    `SELECT p.id,p.sku,p.slug,p.name_en,p.name_ar,p.volume,p.price,p.status,i.stock,ci.quantity,(SELECT url FROM product_images WHERE product_id=p.id ORDER BY position LIMIT 1) image FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN inventory i ON i.product_id=p.id WHERE ci.cart_id=$1 ORDER BY p.id`,
    [c.rows[0].id],
  );
  const subtotal = r.rows.reduce((n, x) => n + (x.price || 0) * x.quantity, 0);
  const discount = bundleDiscount(r.rows);
  return {
    id: c.rows[0].id,
    items: r.rows,
    subtotal,
    discount,
    total: subtotal - discount,
    valid:
      r.rows.length > 0 &&
      r.rows.every(
        (x) => x.status === "active" && x.price > 0 && x.stock >= x.quantity,
      ),
  };
}
export async function setCartItem(
  s: Session,
  productId: string,
  quantity: number,
  increment = false,
) {
  return transaction(async (db) => {
    const c = await db.query(
      "INSERT INTO carts(session_id) VALUES($1) ON CONFLICT(session_id) DO UPDATE SET updated_at=now() RETURNING id",
      [s.id],
    );
    const cartId = c.rows[0].id;
    if (increment) {
      const existing = (
        await db.query(
          "SELECT quantity FROM cart_items WHERE cart_id=$1 AND product_id=$2",
          [cartId, productId],
        )
      ).rows[0];
      quantity += existing?.quantity || 0;
      requireCondition(quantity <= 99, 400, "QUANTITY_LIMIT");
    }
    if (quantity === 0) {
      await db.query(
        "DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2",
        [cartId, productId],
      );
      return;
    }
    const p = (
      await db.query(
        "SELECT p.price,p.status,i.stock FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.id=$1",
        [productId],
      )
    ).rows[0];
    requireCondition(p && p.status === "active", 404, "PRODUCT_NOT_FOUND");
    requireCondition(p.price > 0, 409, "PRICE_UNAVAILABLE");
    requireCondition(p.stock >= quantity, 409, "INSUFFICIENT_STOCK");
    const count = await db.query(
      "SELECT count(*)::int count FROM cart_items WHERE cart_id=$1",
      [cartId],
    );
    requireCondition(
      count.rows[0].count < 50 ||
        !!(
          await db.query(
            "SELECT 1 FROM cart_items WHERE cart_id=$1 AND product_id=$2",
            [cartId, productId],
          )
        ).rowCount,
      409,
      "CART_LIMIT",
    );
    await db.query(
      "INSERT INTO cart_items(cart_id,product_id,quantity) VALUES($1,$2,$3) ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity",
      [cartId, productId, quantity],
    );
  });
}
export function discountAmount(subtotal: number, type: string, value: number) {
  requireCondition(
    Number.isSafeInteger(subtotal) &&
      subtotal > 0 &&
      Number.isSafeInteger(value) &&
      value > 0,
    400,
    "INVALID_DISCOUNT",
  );
  return Math.min(
    subtotal - 1,
    type === "percent" ? Math.floor((subtotal * value) / 10000) : value,
  );
}
export async function enqueue(
  db: DB,
  kind: string,
  orderId: string | null,
  key: string,
  payload: unknown = {},
) {
  await db.query(
    "INSERT INTO outbox(kind,order_id,dedupe_key,payload) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",
    [kind, orderId, key, JSON.stringify(payload)],
  );
}
export async function checkout(
  s: Session,
  data: z.infer<typeof checkoutSchema>,
) {
  const order = await transaction(async (db) => {
    await db.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [s.id]);
    const requestHash = hash(JSON.stringify(data));
    const prior = (
      await db.query(
        `SELECT o.*,p.checkout_url,p.status payment_status
         FROM orders o JOIN payments p ON p.order_id=o.id
         WHERE o.session_id=$1 AND o.idempotency_key=$2`,
        [s.id, data.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      requireCondition(
        prior.request_hash === requestHash,
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      return {
        id: prior.id,
        reference: prior.reference,
        trackingToken: sign("tracking:" + prior.id),
        payment: prior.payment_method,
        checkoutUrl: prior.checkout_url || undefined,
        reused: true,
      };
    }
    const settings = (
      await db.query("SELECT * FROM store_settings WHERE id=1 FOR SHARE")
    ).rows[0];
    requireCondition(settings.enabled, 409, "STORE_NOT_READY");
    const legal = await db.query(
      "SELECT count(*)::int n FROM content WHERE key IN ('terms','privacy','returns','shipping-policy') AND published=true",
    );
    requireCondition(legal.rows[0].n === 4, 409, "POLICIES_NOT_READY");
    if (data.payment === "cod")
      requireCondition(settings.cod_enabled, 409, "PAYMENT_UNAVAILABLE");
    else if (data.payment === "paymob")
      requireCondition(paymobSettings().enabled, 503, "PAYMENT_UNAVAILABLE");
    else {
      const manual = manualPaymentSettings();
      requireCondition(
        data.payment === "instapay"
          ? manual.instapay.enabled
          : manual.vodafoneCash.enabled,
        503,
        "PAYMENT_UNAVAILABLE",
      );
    }
    requireCondition(s.customer_account_id, 401, "CUSTOMER_LOGIN_REQUIRED");
    const account = (
      await db.query(
        `SELECT id,name,first_name,last_name,email,mobile FROM customer_accounts
         WHERE id=$1 AND active=true FOR SHARE`,
        [s.customer_account_id],
      )
    ).rows[0];
    requireCondition(account, 401, "CUSTOMER_LOGIN_REQUIRED");
    requireCondition(
      account.first_name?.trim() && account.last_name?.trim() && account.mobile,
      409,
      "PROFILE_INCOMPLETE",
    );
    let delivery = {
      fullName: data.fullName,
      mobile: data.mobile,
      email: account.email,
      governorate: data.governorate,
      city: data.city,
      street: data.street,
      building: data.building,
      floor: data.floor,
      apartment: data.apartment,
      notes: data.notes,
    };
    if (data.savedAddressId) {
      requireCondition(account, 401, "CUSTOMER_LOGIN_REQUIRED");
      const saved = (
        await db.query(
          "SELECT * FROM saved_addresses WHERE id=$1 AND account_id=$2",
          [data.savedAddressId, account.id],
        )
      ).rows[0];
      requireCondition(saved, 404, "ADDRESS_NOT_FOUND");
      delivery = {
        fullName: saved.full_name,
        mobile: saved.mobile,
        email: account.email,
        governorate: saved.governorate,
        city: saved.city,
        street: saved.street,
        building: saved.building,
        floor: saved.floor,
        apartment: saved.apartment,
        notes: data.notes || saved.notes,
      };
    }
    const cart = (
      await db.query("SELECT id FROM carts WHERE session_id=$1 FOR UPDATE", [
        s.id,
      ])
    ).rows[0];
    requireCondition(cart, 409, "EMPTY_CART");
    const items = (
      await db.query(
        "SELECT p.*,i.stock,ci.quantity FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN inventory i ON i.product_id=p.id WHERE ci.cart_id=$1 ORDER BY p.id FOR UPDATE OF i,p,ci",
        [cart.id],
      )
    ).rows;
    requireCondition(items.length, 409, "EMPTY_CART");
    let subtotal = 0;
    for (const item of items) {
      requireCondition(
        item.status === "active" && item.price > 0,
        409,
        "PRICE_UNAVAILABLE",
      );
      requireCondition(
        item.quantity >= 1 &&
          item.quantity <= 99 &&
          item.stock >= item.quantity,
        409,
        "INSUFFICIENT_STOCK",
      );
      subtotal += item.price * item.quantity;
    }
    requireCondition(
      Number.isSafeInteger(subtotal) && subtotal <= 100000000,
      400,
      "ORDER_LIMIT",
    );
    let couponId = null,
      discount = bundleDiscount(items);
    if (data.coupon) {
      const c = (
        await db.query("SELECT * FROM coupons WHERE code=$1 FOR UPDATE", [
          data.coupon.toUpperCase(),
        ])
      ).rows[0];
      requireCondition(
        c &&
          c.active &&
          c.used < c.usage_limit &&
          (!c.starts_at || c.starts_at <= new Date()) &&
          (!c.ends_at || c.ends_at >= new Date()) &&
          subtotal >= c.minimum,
        400,
        "INVALID_COUPON",
      );
      const couponDiscount = discountAmount(subtotal, c.type, c.value);
      // Apply the better promotion once; do not consume an unused coupon.
      if (couponDiscount >= discount) {
        discount = couponDiscount;
        couponId = c.id;
        await db.query("UPDATE coupons SET used=used+1 WHERE id=$1", [c.id]);
      }
    }
    const fee = shippingFee(
      settings,
      delivery.governorate,
      subtotal - discount,
    );
    const customer = (
      await db.query(
        "INSERT INTO customers(name,email,mobile) VALUES($1,$2,$3) RETURNING id",
        [delivery.fullName, delivery.email, delivery.mobile],
      )
    ).rows[0];
    const address = (
      await db.query(
        "INSERT INTO addresses(customer_id,governorate,city,street,building,floor,apartment) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          customer.id,
          delivery.governorate,
          delivery.city,
          delivery.street,
          delivery.building,
          delivery.floor,
          delivery.apartment,
        ],
      )
    ).rows[0];
    const id = randomUUID(),
      reference =
        "SOL-" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(),
      trackingToken = sign("tracking:" + id);
    await db.query(
      `INSERT INTO orders(id,reference,session_id,customer_id,address_id,account_id,tracking_hash,idempotency_key,request_hash,status,payment_method,subtotal,discount,shipping,total,coupon_id,notes,locale,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17,
       CASE WHEN $10='paymob' THEN now()+interval '30 minutes' ELSE NULL END)`,
      [
        id,
        reference,
        s.id,
        customer.id,
        address.id,
        account.id,
        hash(trackingToken),
        data.idempotencyKey,
        requestHash,
        data.payment,
        subtotal,
        discount,
        fee,
        subtotal - discount + fee,
        couponId,
        delivery.notes,
        data.locale,
      ],
    );
    for (const item of items) {
      await db.query(
        "INSERT INTO order_items(order_id,product_id,sku,name_en,name_ar,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          item.id,
          item.sku,
          item.name_en,
          item.name_ar,
          item.quantity,
          item.price,
        ],
      );
      await db.query(
        "UPDATE inventory SET stock=stock-$1,updated_at=now() WHERE product_id=$2",
        [item.quantity, item.id],
      );
    }
    await db.query(
      "INSERT INTO payments(order_id,amount,status,transfer_reference) VALUES($1,$2,$3,$4)",
      [
        id,
        subtotal - discount + fee,
        data.payment === "cod"
          ? "cod_pending"
          : data.payment === "paymob"
            ? "pending"
            : "awaiting_confirmation",
        ["instapay", "vodafone_cash"].includes(data.payment)
          ? data.transferReference || null
          : null,
      ],
    );
    await db.query("INSERT INTO shipments(order_id) VALUES($1)", [id]);
    if (account && data.saveAddress && !data.savedAddressId) {
      const count = (
        await db.query(
          "SELECT count(*)::int n FROM saved_addresses WHERE account_id=$1",
          [account.id],
        )
      ).rows[0].n;
      requireCondition(count < 20, 409, "ADDRESS_LIMIT");
      await db.query(
        `INSERT INTO saved_addresses(account_id,full_name,mobile,governorate,city,street,building,floor,apartment,notes,is_default)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          account.id,
          delivery.fullName,
          delivery.mobile,
          delivery.governorate,
          delivery.city,
          delivery.street,
          delivery.building,
          delivery.floor,
          delivery.apartment,
          delivery.notes,
          count === 0,
        ],
      );
    }
    await db.query("DELETE FROM cart_items WHERE cart_id=$1", [cart.id]);
    if (process.env.EMAIL_ENABLED === "true")
      await enqueue(db, "order-email", id, "order-email:" + id);
    await audit(db, null, "order.created", "orders", id, {
      payment: data.payment,
    });
    return {
      id,
      reference,
      trackingToken,
      payment: data.payment,
      reused: false,
      paymob:
        data.payment === "paymob"
          ? {
              id,
              reference,
              total: subtotal - discount + fee,
              currency: "EGP" as const,
              customer: delivery,
              items: items.map((item) => ({
                name: item.name_en,
                description: `${item.name_en} · ${item.volume}`,
                amount: item.price,
                quantity: item.quantity,
              })),
            }
          : null,
    };
  });
  if (order.payment !== "paymob") return order;
  requireCondition(
    order.checkoutUrl || (!order.reused && order.paymob),
    409,
    "PAYMENT_SESSION_UNAVAILABLE",
  );
  if (order.checkoutUrl) return order;
  try {
    const intent = await createPaymobIntention(order.paymob!);
    await transaction(async (db) => {
      const current = (
        await db.query(
          `SELECT o.status,p.status payment_status,p.provider_id
           FROM orders o JOIN payments p ON p.order_id=o.id
           WHERE o.id=$1 FOR UPDATE OF o,p`,
          [order.id],
        )
      ).rows[0];
      requireCondition(
        current?.status === "pending" &&
          current.payment_status === "pending" &&
          !current.provider_id,
        409,
        "INVALID_TRANSITION",
      );
      await db.query(
        `UPDATE payments
         SET provider_id=$1,provider_order_id=$2,checkout_url=$3,updated_at=now()
         WHERE order_id=$4`,
        [
          intent.providerId,
          intent.providerOrderId,
          intent.checkoutUrl,
          order.id,
        ],
      );
      await audit(db, null, "payment.paymob-created", "orders", order.id, {
        providerOrderId: intent.providerOrderId,
      });
    });
    return { ...order, checkoutUrl: intent.checkoutUrl, paymob: undefined };
  } catch (error) {
    await transaction(async (db) => {
      const current = (
        await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
          order.id,
        ])
      ).rows[0];
      if (current?.status === "pending") {
        await releaseStock(db, current);
        await db.query(
          "UPDATE orders SET status='cancelled',expires_at=NULL,updated_at=now() WHERE id=$1",
          [order.id],
        );
        await db.query(
          "UPDATE payments SET status='failed',updated_at=now() WHERE order_id=$1",
          [order.id],
        );
        if (current.coupon_id)
          await db.query(
            "UPDATE coupons SET used=GREATEST(used-1,0) WHERE id=$1",
            [current.coupon_id],
          );
        await audit(db, null, "payment.paymob-init-failed", "orders", order.id);
      }
    });
    throw error;
  }
}
export async function releaseStock(
  db: DB,
  order: { id: string; stock_released: boolean },
) {
  if (order.stock_released) return;
  const items = (
    await db.query(
      "SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id",
      [order.id],
    )
  ).rows;
  for (const item of items)
    await db.query("UPDATE inventory SET stock=stock+$1 WHERE product_id=$2", [
      item.quantity,
      item.product_id,
    ]);
  await db.query("UPDATE orders SET stock_released=true WHERE id=$1", [
    order.id,
  ]);
}
export async function expirePendingPayments(limit = 30) {
  requireCondition(
    Number.isInteger(limit) && limit >= 1 && limit <= 100,
    400,
    "INVALID_INPUT",
  );
  return transaction(async (db) => {
    const expired = (
      await db.query(
        `SELECT * FROM orders
         WHERE status='pending' AND payment_method IN ('card','paymob') AND expires_at<now()
         ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      )
    ).rows;
    for (const order of expired) {
      await releaseStock(db, order);
      await db.query(
        "UPDATE orders SET status='cancelled',expires_at=NULL,updated_at=now() WHERE id=$1",
        [order.id],
      );
      await db.query(
        "UPDATE payments SET status='failed',updated_at=now() WHERE order_id=$1 AND status='pending'",
        [order.id],
      );
      if (order.coupon_id)
        await db.query(
          "UPDATE coupons SET used=GREATEST(used-1,0) WHERE id=$1",
          [order.coupon_id],
        );
      await audit(db, null, "payment.reservation-expired", "orders", order.id);
    }
    return expired.length;
  });
}
export async function changeOrder(actor: string, id: string, status: string) {
  return transaction(async (db) => {
    const o = (
      await db.query(
        "SELECT o.*,p.status payment_status FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 FOR UPDATE OF o,p",
        [id],
      )
    ).rows[0];
    requireCondition(o, 404, "ORDER_NOT_FOUND");
    const allowed: Record<string, string[]> = {
      pending:
        o.payment_method === "cod"
          ? ["processing", "cancelled"]
          : ["cancelled"],
      paid: ["processing"],
      processing:
        o.payment_status === "paid" ? ["shipped"] : ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: [],
      refunded: [],
    };
    requireCondition(
      allowed[o.status]?.includes(status),
      409,
      "INVALID_TRANSITION",
    );
    if (status === "cancelled") {
      await releaseStock(db, o);
      if (
        ["pending", "cod_pending", "awaiting_confirmation"].includes(
          o.payment_status,
        )
      )
        await db.query(
          "UPDATE payments SET status='cancelled',updated_at=now() WHERE order_id=$1",
          [id],
        );
    }
    await db.query("UPDATE orders SET status=$1,updated_at=now() WHERE id=$2", [
      status,
      id,
    ]);
    await audit(db, actor, "order.status", "orders", id, {
      from: o.status,
      to: status,
    });
    if (process.env.EMAIL_ENABLED === "true")
      await enqueue(
        db,
        "status-email",
        id,
        "status-email:" + id + ":" + status,
      );
  });
}
export async function quote(s: Session, governorate: string, code: string) {
  const cart = await getCart(s);
  requireCondition(cart.valid, 409, "CART_UNAVAILABLE");
  const settings = (await pool.query("SELECT * FROM store_settings WHERE id=1"))
    .rows[0];
  let discount = cart.discount;
  if (code) {
    const c = (
      await pool.query("SELECT * FROM coupons WHERE code=$1", [
        code.toUpperCase(),
      ])
    ).rows[0];
    requireCondition(
      c &&
        c.active &&
        c.used < c.usage_limit &&
        (!c.starts_at || c.starts_at <= new Date()) &&
        (!c.ends_at || c.ends_at >= new Date()) &&
        cart.subtotal >= c.minimum,
      400,
      "INVALID_COUPON",
    );
    discount = Math.max(
      discount,
      discountAmount(cart.subtotal, c.type, c.value),
    );
  }
  const fee = shippingFee(settings, governorate, cart.subtotal - discount);
  return {
    subtotal: cart.subtotal,
    discount,
    shipping: fee,
    total: cart.subtotal - discount + fee,
  };
}
