import assert from "node:assert/strict";
import test from "node:test";
import { visibleApprovalRows, pendingValuePgk, type ApprovalInboxRow } from "../../lib/workflow/erp-approval-inbox";

const base: ApprovalInboxRow = {
  id: "a", companyId: "company-1", documentKind: "PURCHASE_ORDER", documentNo: "PO-1",
  amountPgk: 100, creatorUserId: "maker", status: "UNDER_REVIEW",
  requiredRole: "SUPPLY_CHAIN_MANAGER", policyVersion: 1, updatedAt: "2026-10-19T08:00:00Z",
};

test("inbox restricts company, assigned role and reviewer identity", () => {
  const rows = [
    base,
    {...base,id:"b",companyId:"company-2"},
    {...base,id:"c",creatorUserId:"checker"},
    {...base,id:"d",assignedUserId:"other"},
    {...base,id:"e",status:"APPROVED" as const},
    {...base,id:"f",requiredRole:"CFO" as const},
    {...base,id:"g",assignedUserId:"checker"},
  ];
  const result=visibleApprovalRows(rows,{companyId:"company-1",userId:"checker",roles:["SUPPLY_CHAIN_MANAGER"]});
  assert.deepEqual(result.map((r)=>r.id),["a","g"]);
});
test("default-deny with missing actor context",()=>{
  assert.deepEqual(visibleApprovalRows([base],{companyId:"company-1",userId:"",roles:["SUPPLY_CHAIN_MANAGER"]}),[]);
});
test("pending totals ignore invalid non-finite amounts",()=>{
  assert.equal(pendingValuePgk([base,{...base,id:"bad",amountPgk:Number.NaN}]),100);
});
