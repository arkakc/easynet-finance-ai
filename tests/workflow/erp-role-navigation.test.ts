import test from "node:test";
import assert from "node:assert/strict";
import { permittedRoleNavigation } from "../../lib/workflow/erp-role-navigation";
test("AP can view supplier bills but not sales invoices",()=>{
 const x=permittedRoleNavigation([{name:"SUPPLIER_BILL",actions:["READ","CREATE"]}],[{name:"AP_LEDGER",actions:["READ"]}]);
 assert.ok(x.some(link=>link.label==="Supplier Bills"));
 assert.ok(!x.some(link=>link.label==="Sales Invoices"));
});
test("journal creation needs CREATE not READ",()=>{
 const x=permittedRoleNavigation([{name:"MANUAL_JOURNAL",actions:["READ"]}],[]);
 assert.ok(!x.some(link=>link.label==="Journal Entry"));
});
test("empty permissions present no navigation",()=>{
 assert.deepEqual(permittedRoleNavigation([],[]),[]);
});
