import test from "node:test";
import assert from "node:assert/strict";
import { stockMovementQuantities } from "../../lib/accounting/stock-movement-direction";
import { inventoryState } from "../../lib/accounting/inventory";

test("posted sales delivery reduces SOH and value in stock details", () => {
  const receipt = { ...stockMovementQuantities("PURCHASE_RECEIPT", 10), value: 5000 };
  const delivery = { ...stockMovementQuantities("SALES_DELIVERY", 2), value: 1000 };
  assert.deepEqual(delivery, { qtyIn: 0, qtyOut: 2, value: 1000 });
  const state = inventoryState([receipt, delivery], 500);
  assert.equal(state.qty, 8);
  assert.equal(state.value, 4000);
  assert.equal(receipt.qtyIn + delivery.qtyIn, 10);
  assert.equal(receipt.qtyOut + delivery.qtyOut, 2);
});
test("delivery rollback restores stock and cost valuation", () => {
  const state = inventoryState([
    { ...stockMovementQuantities("PURCHASE_RECEIPT", 10), value: 5000 },
    { ...stockMovementQuantities("SALES_DELIVERY", 2), value: 1000 },
    { ...stockMovementQuantities("SALES_ISSUE_ROLLBACK", 2), value: 1000 },
  ], 500);
  assert.equal(state.qty, 10);
  assert.equal(state.value, 5000);
});
