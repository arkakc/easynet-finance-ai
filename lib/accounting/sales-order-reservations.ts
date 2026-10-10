export type ReservationOrder = {
  id: string;
  code: string;
  status: string;
  lines: Array<{ itemId: string | null; quantity: unknown }>;
};
export type ReservationDelivery = {
  referenceId: string | null;
  itemId: string;
  type: string;
  quantity: unknown;
};
const eligible = new Set(["ACCEPTED", "SENT", "PART_DELIVERED", "PART_INVOICED", "INVOICED"]);
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * A quotation (SQ) is not an inventory commitment. Only confirmed SO records
 * reserve their undelivered lines; posted delivery movements release it.
 * Derived result is read-only and is never added to manually stored reserved.
 */
export function salesOrderReservations(orders: ReservationOrder[], deliveries: ReservationDelivery[]) {
  const delivered = new Map<string, number>();
  for (const row of deliveries) {
    if (row.type !== "SALES_DELIVERY" && row.type !== "SALES_ISSUE") continue;
    if (!row.referenceId || !row.itemId) continue;
    const key = `${row.referenceId}::${row.itemId}`;
    delivered.set(key, round4((delivered.get(key) || 0) + Number(row.quantity || 0)));
  }
  const reserved = new Map<string, number>();
  for (const order of orders) {
    if (!/^SO-/i.test(order.code) || !eligible.has(order.status.toUpperCase())) continue;
    const qtyByItem = new Map<string, number>();
    for (const line of order.lines) {
      if (!line.itemId) continue;
      qtyByItem.set(line.itemId, round4((qtyByItem.get(line.itemId) || 0) + Number(line.quantity || 0)));
    }
    for (const [itemId, ordered] of qtyByItem) {
      const remaining = Math.max(0, round4(ordered - (delivered.get(`${order.id}::${itemId}`) || 0)));
      reserved.set(itemId, round4((reserved.get(itemId) || 0) + remaining));
    }
  }
  return reserved;
}
