export type OpenPurchaseOrder = {
  id: string;
  code: string;
  status: string;
  baseTotal: unknown;
  total: unknown;
  lines: Array<{ itemId: string | null; quantity: unknown; unitPrice: unknown; item?: { type: string } | null }>;
};
export type ReceivedStock = { referenceId: string | null; itemId: string; quantity: unknown };
export type BilledService = { orderId: string | null; poReference: string | null; lines: Array<{ itemId: string | null; quantity: unknown }> };

const closedStatuses = new Set(["DRAFT", "BILLED", "CLOSED", "CANCELLED"]);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function nonNegativeAmount(value: unknown, field: string) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${field}: expected a finite non-negative number`);
  return n;
}
const isStock = (kind: string | undefined) => ["GOOD", "STOCK"].includes(String(kind || "").toUpperCase());

/** Unfulfilled PO contractual value, not unpaid AP or unapplied vendor cash. */
export function outstandingPurchaseCommitments(orders: OpenPurchaseOrder[], movements: ReceivedStock[], bills: BilledService[]) {
  return round2(orders.reduce((grand, order) => {
    // Supplier Quotations share the PurchaseOrder table but are not contractual POs.
    if (!/^PO-/i.test(String(order.code || ""))) return grand;
    if (closedStatuses.has(String(order.status).toUpperCase())) return grand;
    const received = new Map<string, number>();
    for (const movement of movements) {
      if (movement.referenceId !== order.id && movement.referenceId !== order.code) continue;
      received.set(movement.itemId, (received.get(movement.itemId) || 0) + nonNegativeAmount(movement.quantity, "received quantity"));
    }
    const billed = new Map<string, number>();
    for (const bill of bills) {
      if (bill.orderId !== order.id && ![order.id, order.code].includes(bill.poReference || "")) continue;
      for (const line of bill.lines) {
        if (!line.itemId) continue;
        billed.set(line.itemId, (billed.get(line.itemId) || 0) + nonNegativeAmount(line.quantity, "billed quantity"));
      }
    }
    const orderedByItem = new Map<string, { quantity: number; value: number; stock: boolean }>();
    for (const line of order.lines) {
      const key = line.itemId || `non-item:${order.id}:${orderedByItem.size}`;
      const prior = orderedByItem.get(key) || { quantity: 0, value: 0, stock: isStock(line.item?.type) };
      prior.quantity += nonNegativeAmount(line.quantity, "ordered quantity");
      prior.value += nonNegativeAmount(line.quantity, "ordered quantity") * nonNegativeAmount(line.unitPrice, "unit price");
      orderedByItem.set(key, prior);
    }
    const orderedNet = [...orderedByItem.values()].reduce((sum, row) => sum + row.value, 0);
    if (orderedNet <= 0) return grand;
    let outstandingNet = 0;
    for (const [itemId, row] of orderedByItem) {
      const fulfilled = row.stock ? (received.get(itemId) || 0) : (billed.get(itemId) || 0);
      outstandingNet += row.value * Math.max(0, row.quantity - fulfilled) / Math.max(row.quantity, 0.000001);
    }
    const specifiedBaseTotal = nonNegativeAmount(order.baseTotal, "base total");
    const baseTotal = specifiedBaseTotal > 0 ? specifiedBaseTotal : nonNegativeAmount(order.total, "total");
    return grand + round2(baseTotal * (outstandingNet / orderedNet));
  }, 0));
}
