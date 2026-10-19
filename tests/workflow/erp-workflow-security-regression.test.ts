import assert from "node:assert/strict";
import test from "node:test";
import { canAct, requiredApproverRoles } from "../../lib/workflow/erp-approval-policy";
import { readLegacyApprovalCandidate, canOfferLegacyApprovalHandoff } from "../../lib/workflow/erp-document-integration";
import { visibleApprovalRows } from "../../lib/workflow/erp-approval-inbox";
import { nextApprovalStatus } from "../../lib/workflow/erp-approval-transitions";

test("policy never lets creator self-approve despite elevated role", () => {
  assert.equal(canAct({
    documentKind:"SUPPLIER_BILL",status:"UNDER_REVIEW",amountPgk:1000,
    actorId:"same",creatorId:"same",roles:["FINANCE_CONTROLLER"],
    reviewedBy:["different"],
  },"APPROVE").allowed,false);
});
test("reviewer and approver must be independent", () => {
  assert.equal(canAct({
    documentKind:"SUPPLIER_BILL",status:"UNDER_REVIEW",amountPgk:1000,
    actorId:"reviewer",creatorId:"maker",roles:["FINANCE_CONTROLLER"],
    reviewedBy:["reviewer"],
  },"APPROVE").allowed,false);
});
test("risk escalation never reduces approval levels", () => {
  assert.deepEqual(requiredApproverRoles("PURCHASE_ORDER",25000,["BUDGET_OVERRUN"]),["SUPPLY_CHAIN_MANAGER","CFO"]);
  assert.deepEqual(requiredApproverRoles("PURCHASE_ORDER",75000,["PRICE_VARIANCE"]),["SUPPLY_CHAIN_MANAGER","CFO","CEO"]);
});
test("legacy document gate rejects missing creator and posted document", () => {
  const input={recordType:"supplierBill" as const,recordId:"B-1",status:"DRAFT",companyId:"tenant",creatorUserId:"maker",amount:100};
  assert.equal(readLegacyApprovalCandidate(input).eligible,true);
  assert.equal(readLegacyApprovalCandidate({...input,creatorUserId:null}).eligible,false);
  assert.equal(readLegacyApprovalCandidate({...input,status:"POSTED"}).eligible,false);
  assert.equal(canOfferLegacyApprovalHandoff("APPROVED","DRAFT",1,2),false);
});
test("inbox isolates companies and assigned users", () => {
  const rows=[{id:"1",companyId:"A",documentKind:"PURCHASE_ORDER",documentNo:"PO-1",amountPgk:100,creatorUserId:"maker",status:"UNDER_REVIEW" as const,requiredRole:"SUPPLY_CHAIN_MANAGER" as const,assignedUserId:"assignee",policyVersion:1,updatedAt:"2026-10-19T00:00:00Z"}];
  assert.equal(visibleApprovalRows(rows,{companyId:"B",userId:"assignee",roles:["SUPPLY_CHAIN_MANAGER"]}).length,0);
  assert.equal(visibleApprovalRows(rows,{companyId:"A",userId:"stranger",roles:["SUPPLY_CHAIN_MANAGER"]}).length,0);
});
test("posted journal or stock cannot transition through draft approval", () => {
  assert.throws(()=>nextApprovalStatus("POSTED","APPROVE",0));
  assert.throws(()=>nextApprovalStatus("RELEASED","SUBMIT"));
});
