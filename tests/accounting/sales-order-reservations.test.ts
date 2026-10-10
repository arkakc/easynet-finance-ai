import test from "node:test";
import assert from "node:assert/strict";
import { salesOrderReservations } from "../../lib/accounting/sales-order-reservations";

test("quotations never reserve stock, even accepted quotations", () => {
  const rows = [{ id: "q1", code: "SQ-2026-0000001", status: "ACCEPTED", lines: [{ itemId: "item1", quantity: 5 }] }];
  assert.equal(salesOrderReservations(rows, []).get("item1") || 0, 0);
});
test("confirmed orders reserve undelivered stock and partial delivery releases reservation", () => {
  const rows = [{ id: "so1", code: "SO-2026-0000001", status: "PART_DELIVERED", lines: [{ itemId: "item1", quantity: 5 }] }];
  assert.equal(salesOrderReservations(rows, [{ referenceId: "so1", itemId: "item1", type: "SALES_DELIVERY", quantity: 2 }]).get("item1"), 3);
});
test("draft, rejected, cancelled and delivered orders do not reserve", () => {
  for (const status of ["DRAFT", "REJECTED", "CANCELLED", "DELIVERED"]) {
    assert.equal(salesOrderReservations([{ id: "so1", code: "SO-2026-0000001", status, lines: [{ itemId: "item1", quantity: 5 }] }], []).get("item1") || 0, 0);
  }
});
test("multiple orders sum remaining and over-delivery never creates negative reservations", () => {
  const orders = [
    { id: "a", code: "SO-2026-0000001", status: "ACCEPTED", lines: [{ itemId: "x", quantity: 4 }] },
    { id: "b", code: "SO-2026-0000002", status: "ACCEPTED", lines: [{ itemId: "x", quantity: 3 }] },
  ];
  assert.equal(salesOrderReservations(orders, [{referenceId:"a", itemId:"x",type:"SALES_DELIVERY",quantity: 10}]).get("x"),3);
});
