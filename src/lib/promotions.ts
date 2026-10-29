// All amounts are EGP minor units. Eligibility is rechecked against database rows.
export const TWO_BOTTLE_TOTAL = 44999;
export function twoBottleDiscount(item: {
  sku: string;
  slug: string;
  price: number | null;
  quantity: number;
}) {
  if (
    item.sku !== "SOL-125" ||
    item.slug !== "baby-shampoo" ||
    !Number.isSafeInteger(item.price) ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 2 ||
    item.quantity > 99 ||
    !item.price ||
    item.price <= 0
  )
    return 0;
  return (
    Math.floor(item.quantity / 2) *
    Math.max(0, item.price * 2 - TWO_BOTTLE_TOTAL)
  );
}
export function bundleDiscount(
  items: Parameters<typeof twoBottleDiscount>[0][],
) {
  return items.reduce((total, item) => total + twoBottleDiscount(item), 0);
}
