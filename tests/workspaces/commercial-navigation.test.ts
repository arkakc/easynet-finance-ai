import { test } from "node:test";
import { strict as assert } from "node:assert";
import { COMMERCIAL_CATEGORY_ORDER, commercialCategory, organizeCommercialActions } from "../../lib/workspaces/commercial-navigation";
import type { WorkspaceAction } from "../../lib/workspaces/module-registry";

const action = (title: string, section: string, href = "/example"): WorkspaceAction =>
  ({ title, description: title, section, href, permission: "sales.read" });

test("Sales and Purchases share the same category order", () => {
  assert.deepEqual(COMMERCIAL_CATEGORY_ORDER, [
    "Quotations", "Orders", "Fulfilment", "Billing",
    "Payments", "Returns", "Bulk Operations", "Registers", "Masters", "Projects", "All",
  ]);
});

test("matching lifecycle actions map to identical categories", () => {
  assert.equal(commercialCategory(action("Deliveries", "Deliveries")), "Fulfilment");
  assert.equal(commercialCategory(action("Goods Receipts (GRN)", "Receipts")), "Fulfilment");
  assert.equal(commercialCategory(action("Sales Invoices", "Invoices")), "Billing");
  assert.equal(commercialCategory(action("Supplier Bills", "Bills")), "Billing");
  assert.equal(commercialCategory(action("Customer Receipts", "Receipts")), "Payments");
  assert.equal(commercialCategory(action("Supplier Payments", "Payments")), "Payments");
  assert.equal(commercialCategory(action("Bulk Invoice Approval", "Registers", "/sales/bulk-invoice-approval")), "Bulk Operations");
  assert.equal(commercialCategory(action("Bulk Supplier Quote Conversion", "Quotations", "/purchases/bulk-processing")), "Bulk Operations");
  assert.equal(commercialCategory(action("PO / GRN / Bill Reconciliation", "Bills")), "Registers");
  assert.equal(commercialCategory(action("Retail POS Terminal", "Registers")), "Registers");
});

test("action order is normalized without changing destinations or permissions", () => {
  const actions = [
    action("Suppliers", "Masters", "/suppliers"),
    action("Bulk Goods Receipt Drafts", "Receipts", "/purchases/bulk-receipts"),
    action("Purchase Orders", "Orders", "/doctype/purchaseOrder"),
    action("Supplier Quotations", "Quotations", "/doctype/supplierQuote"),
  ];
  const result = organizeCommercialActions(actions, "purchases");
  assert.deepEqual(result.map(item => item.section), ["Quotations", "Orders", "Bulk Operations", "Masters"]);
  assert.deepEqual(result.map(item => item.href), ["/doctype/supplierQuote", "/doctype/purchaseOrder", "/purchases/bulk-receipts", "/suppliers"]);
  assert.equal(result.every(item => item.permission === "sales.read"), true);
  assert.equal(actions[0].section, "Masters");
});
test("other module layouts are preserved", () => {
  const originals = [action("Financial Statements", "Financial")];
  assert.deepEqual(organizeCommercialActions(originals, "reports"), originals);
});
