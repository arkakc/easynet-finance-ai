import assert from "node:assert/strict";
import test from "node:test";
import { suggestNextActions } from "../../lib/erp/intelligent-next-actions";

test("suggests existing linked sales order before converting again", () => {
  const result = suggestNextActions({ type: "quote", id: "Q-1", status: "APPROVED", number: "SQ-1", links: [
    { type: "quote", label: "Sales Order", href: "/transactions/quote/SO-1", direction: "next" },
  ] });
  assert.equal(result[0]?.key, "existing-order");
  assert.equal(result.some(row => row.key === "sales-order"), false);
});
test("suggests controlled invoice settlement with source reference", () => {
  const result = suggestNextActions({ type: "invoice", id: "INV-1", status: "POSTED", links: [] });
  assert.equal(result[0]?.href, "/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=INV-1");
});
test("does not suggest cancelled document actions", () => {
  assert.deepEqual(suggestNextActions({ type: "purchaseOrder", id: "PO-1", status: "CANCELLED", links: [] }), []);
});
test("does not trust external linked conversion targets", () => {
  const result = suggestNextActions({ type: "quote", id: "Q-1", status: "APPROVED", links: [
    { label: "Sales Order", href: "https://example.invalid", direction: "next" },
  ] });
  assert.equal(result[0]?.key, "sales-order");
});
