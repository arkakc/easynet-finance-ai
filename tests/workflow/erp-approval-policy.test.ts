import assert from "node:assert/strict";
import test from "node:test";
import { canAct, requiredApproverRoles, type PolicyContext } from "../../lib/workflow/erp-approval-policy";

const base: PolicyContext = {
  documentKind: "PURCHASE_ORDER", status: "UNDER_REVIEW", amountPgk: 5_000,
  actorId: "manager", creatorId: "officer", roles: ["SUPPLY_CHAIN_MANAGER"],
  reviewedBy: ["reviewer"],
};

test("PO risk/amount approvals escalate by delegated authority", () => {
  assert.deepEqual(requiredApproverRoles("PURCHASE_ORDER", 5000), ["SUPPLY_CHAIN_MANAGER"]);
  assert.deepEqual(requiredApproverRoles("PURCHASE_ORDER", 25000), ["SUPPLY_CHAIN_MANAGER","CFO"]);
  assert.deepEqual(requiredApproverRoles("PURCHASE_ORDER", 75000), ["SUPPLY_CHAIN_MANAGER","CFO","CEO"]);
  assert.deepEqual(requiredApproverRoles("PURCHASE_ORDER", 5000, ["PRICE_VARIANCE"]), ["SUPPLY_CHAIN_MANAGER","CFO"]);
});
test("maker cannot approve even with manager role", () => {
  assert.equal(canAct({ ...base, actorId: "officer" }, "APPROVE").allowed, false);
});
test("reviewer cannot approve same document", () => {
  assert.equal(canAct({ ...base, actorId: "reviewer" }, "APPROVE").allowed, false);
});
test("approval requires independent review evidence", () => {
  assert.equal(canAct({ ...base, reviewedBy: [] }, "APPROVE").allowed, false);
});
test("approval must follow sequential roles", () => {
  assert.equal(canAct(base, "APPROVE").allowed, true);
  assert.equal(canAct({ ...base, amountPgk: 25000, actorId: "cfo", roles: ["CFO"] }, "APPROVE").allowed, false);
  assert.equal(canAct({ ...base, amountPgk: 25000, actorId: "cfo", roles: ["CFO"], approvedBy: ["manager"] }, "APPROVE").allowed, true);
});
test("risk flags hold approval until resolved", () => {
  assert.equal(canAct({ ...base, flags: ["SUPPLIER_BANK_CHANGED"] }, "APPROVE").allowed, false);
});
test("draft delete requires creator and no dependency", () => {
  const draft={...base,status:"DRAFT" as const,actorId:"officer",roles:["SUPPLY_CHAIN_OFFICER" as const]};
  assert.equal(canAct(draft, "DELETE").allowed, true);
  assert.equal(canAct({...draft,hasBlockingDependency:true}, "DELETE").allowed, false);
});
test("posted actions never allow hard delete or unsafe release", () => {
  assert.equal(canAct({...base,status:"POSTED"}, "DELETE").allowed, false);
  assert.equal(canAct({...base,status:"APPROVED"}, "RELEASE").allowed, false);
  assert.equal(canAct({...base,status:"POSTED"}, "REVERSE").allowed, false);
});
test("reject invalid amounts", () => {
  assert.throws(()=>requiredApproverRoles("PURCHASE_ORDER", Number.NaN));
  assert.equal(canAct({...base,amountPgk:-1},"APPROVE").allowed,false);
});
