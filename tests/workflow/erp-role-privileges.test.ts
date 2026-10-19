import test from "node:test";
import assert from "node:assert/strict";
import { ERP_ROLES } from "../../lib/workflow/erp-approval-policy";
import { ACCOUNTING_FUNCTIONS, hasErpPrivilege, listRolePrivileges } from "../../lib/workflow/erp-role-privileges";

test("finance AP cannot enter AR invoices",()=>{
 assert.equal(hasErpPrivilege(["FINANCE_OFFICER_AP"],{kind:"DOCTYPE",name:"SUPPLIER_BILL"},"CREATE"),true);
 assert.equal(hasErpPrivilege(["FINANCE_OFFICER_AP"],{kind:"DOCTYPE",name:"SALES_INVOICE"},"CREATE"),false);
 assert.equal(hasErpPrivilege(["FINANCE_OFFICER_AR"],{kind:"ACCOUNTING",name:"AP_LEDGER"},"READ"),false);
});
test("entry cannot grant posting or approval",()=>{
 assert.equal(hasErpPrivilege(["SUPPLY_CHAIN_OFFICER"],{kind:"DOCTYPE",name:"PURCHASE_ORDER"},"SUBMIT"),true);
 assert.equal(hasErpPrivilege(["SUPPLY_CHAIN_OFFICER"],{kind:"DOCTYPE",name:"PURCHASE_ORDER"},"APPROVE"),false);
 assert.equal(hasErpPrivilege(["FINANCE_OFFICER_AP"],{kind:"DOCTYPE",name:"SUPPLIER_BILL"},"POST"),false);
});
test("leadership is not a universal data-entry superuser",()=>{
 assert.equal(hasErpPrivilege(["CEO"],{kind:"DOCTYPE",name:"PURCHASE_ORDER"},"CREATE"),false);
 assert.equal(hasErpPrivilege(["CFO"],{kind:"ACCOUNTING",name:"FINANCIAL_REPORTING"},"READ"),true);
 assert.equal(hasErpPrivilege(["CEO"],{kind:"ACCOUNTING",name:"JOURNAL_ENTRY"},"POST"),false);
});
test("unknown roles/resources are denied by default",()=>{
 assert.equal(hasErpPrivilege(["SYSTEM_MANAGER"],{kind:"DOCTYPE",name:"SUPPLIER_BILL"},"APPROVE"),false);
 assert.equal(hasErpPrivilege(["CEO"],{kind:"ACCOUNTING",name:"UNLISTED" as any},"READ"),false);
});
test("role matrix covers every role and accounting function",()=>{
 for(const role of ERP_ROLES) assert.ok(listRolePrivileges(role));
 assert.ok(ACCOUNTING_FUNCTIONS.length>=10);
});
