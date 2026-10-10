import test from "node:test";
import assert from "node:assert/strict";
import { outstandingPurchaseCommitments } from "../../lib/accounting/purchase-commitments";

const po = { id: "p1", code: "PO-2026-0000001", status: "SENT", baseTotal: 550, total: 550, lines: [{ itemId: "i1", quantity: 5, unitPrice: 100, item: { type: "GOOD" } }] };
test("fully received PO has zero commitment even if supplier payment not made", () => {
  assert.equal(outstandingPurchaseCommitments([po], [{ referenceId: "p1", itemId: "i1", quantity: 5 }], []), 0);
});
test("partially received PO retains only unfulfilled contractual value including proportional GST", () => {
  assert.equal(outstandingPurchaseCommitments([po], [{ referenceId: "p1", itemId: "i1", quantity: 2 }], []), 330);
});
test("unreceived confirmed PO retains full commitment", () => {
  assert.equal(outstandingPurchaseCommitments([po], [], []), 550);
});
test("draft, closed, billed and cancelled POs are excluded", () => {
  for (const status of ["DRAFT", "BILLED", "CLOSED", "Cancelled"]) {
    assert.equal(outstandingPurchaseCommitments([{ ...po, status }], [], []), 0);
  }
});
test("service commitment released when matching supplier bill posted", () => {
  const service = { ...po, lines: [{ itemId: "service", quantity: 2, unitPrice: 250, item: { type: "SERVICE" } }] };
  assert.equal(outstandingPurchaseCommitments([service], [], [{ orderId: "p1", poReference: null, lines: [{ itemId: "service", quantity: 2 }] }]), 0);
});

test("supplier quotations in PurchaseOrder storage do not count as PO commitments", () => {
  const supplierQuote = { ...po, id: "sq1", code: "SUPQ-2026-0000001" };
  assert.equal(outstandingPurchaseCommitments([supplierQuote], [], []), 0);
  assert.equal(outstandingPurchaseCommitments([supplierQuote, po], [], []), 550);
});
