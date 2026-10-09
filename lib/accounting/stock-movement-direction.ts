/** Movement direction used by both quantity and valuation reporting. */
const incoming = new Set(["PURCHASE_IN", "PURCHASE_RECEIPT", "SALES_ISSUE_ROLLBACK", "ADJUSTMENT_IN", "RETURN_IN", "TRANSFER_IN"]);
const outgoing = new Set(["SALES_DELIVERY", "SALES_ISSUE", "SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_OUT", "RETURN_OUT", "TRANSFER_OUT"]);

export function stockMovementQuantities(type: string, quantity: number): { qtyIn: number; qtyOut: number } {
  const key = String(type || "").toUpperCase();
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid stock movement quantity");
  return { qtyIn: incoming.has(key) ? amount : 0, qtyOut: outgoing.has(key) ? amount : 0 };
}
