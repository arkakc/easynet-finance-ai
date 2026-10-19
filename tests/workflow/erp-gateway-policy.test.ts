import test from "node:test";
import assert from "node:assert/strict";
import { approvalResource } from "../../lib/workflow/erp-gateway-policy";

test("maps only known approval subtypes",()=>{
 assert.deepEqual(approvalResource("approvals",{payload:{recordType:"supplierBill",decision:"APPROVE"}}),{resource:{kind:"DOCTYPE",name:"SUPPLIER_BILL"},action:"APPROVE"});
 assert.deepEqual(approvalResource("approvals",{payload:{recordType:"purchaseOrder",decision:"CANCEL"}}),{resource:{kind:"DOCTYPE",name:"PURCHASE_ORDER"},action:"DELETE_DRAFT"});
});
test("ambiguous legacy routes cannot impersonate typed privilege",()=>{
 assert.equal(approvalResource("stock",{}),null);
 assert.equal(approvalResource("approvals",{payload:{recordType:"payment",decision:"APPROVE"}}),null);
 assert.equal(approvalResource("approvals",{payload:{recordType:"invoice",decision:"REVERSE"}}),null);
});
