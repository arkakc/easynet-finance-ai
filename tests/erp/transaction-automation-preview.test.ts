import assert from "node:assert/strict";
import test from "node:test";
import { automationPreview } from "../../lib/erp/transaction-automation-preview";

test("prefills all source line details from approved sales quotation", () => {
  const result = automationPreview("quote", { quoteId: "Q1", quoteNumber: "SQ-1", status: "APPROVED", customerId: "C1", projectId: "P1", currency: "PGK", totalAmount: 110 },
    [], [{ itemId: "I1", description: "Service", qty: 2, rate: 50, uom: "Each" }]);
  assert.equal(result.ready, true);
  assert.equal(result.defaults.partyId, "C1");
  assert.equal(result.defaults.projectId, "P1");
  assert.deepEqual(result.defaults.lines[0], { itemId: "I1", description: "Service", qty: 2, rate: 50, uom: "Each" });
});
test("flags existing supplier bills and filters cancelled duplicates", () => {
  const result = automationPreview("purchaseOrder", { poId: "PO1", status: "APPROVED", supplierId: "S1", totalAmount: 50 },
    [{ sourceDocumentId: "PO1", billId: "B1", billNumber: "PB-1", status: "POSTED" }, { sourceDocumentId: "PO1", billId: "B2", status: "CANCELLED" }],
    [{ itemId: "I1", qty: 1, rate: 50 }]);
  assert.equal(result.duplicateCandidates.length, 1);
  assert.equal(result.duplicateCandidates[0].id, "B1");
  assert.match(result.warnings.join(" "), /existing related/);
});
test("blocks readiness suggestion for draft or unresolved source items", () => {
  const result = automationPreview("quote", { quoteId: "Q1", status: "DRAFT", customerId: "C1", totalAmount: 100 }, [], [{ itemId: "", qty: 1, rate: 100 }]);
  assert.equal(result.ready, false);
});
