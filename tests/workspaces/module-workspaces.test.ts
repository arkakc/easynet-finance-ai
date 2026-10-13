import test from "node:test";
import assert from "node:assert/strict";
import { workspaceFor, workspaceIds, workspaces } from "../../lib/workspaces/module-registry";

test("Phase 2 exposes eight navigable and distinct module workspaces", () => {
  assert.deepEqual(workspaceIds, ["home", "sales", "purchases", "banking", "inventory", "accounting", "projects", "reports"]);
  for (const id of workspaceIds) {
    const workspace = workspaceFor(id);
    assert.ok(workspace?.title);
    assert.ok(workspace.actions.length > 0);
    assert.ok(workspace.actions.every(action => action.href.startsWith("/") && action.permission));
  }
  assert.equal(workspaceFor("../settings"), null);
  assert.equal(workspaceFor("unknown"), null);
});
test("purchase and sales links preserve authoritative registers and tab selection", () => {
  const sales = workspaces.sales.actions;
  const purchase = workspaces.purchases.actions;
  assert.ok(sales.find(action => action.title === "Sales Orders")?.href.includes("tab=salesOrder"));
  assert.ok(purchase.find(action => action.title === "Supplier Bills")?.href.includes("tab=supplierInvoice"));
  assert.ok(purchase.find(action => action.title === "Goods Receipts (GRN)")?.href.includes("tab=purchaseReceipt"));
});
test("all create shortcuts require write permission, no arbitrary posting links", () => {
  for (const id of workspaceIds) {
    for (const action of workspaces[id].actions) {
      if (action.kind === "action") assert.ok(action.permission.endsWith(".write"));
    }
  }
});
