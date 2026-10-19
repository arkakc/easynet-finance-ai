import assert from "node:assert/strict";
import test from "node:test";
import { effectiveCompanyRoles, canAccessCompanyResource } from "../../lib/workflow/erp-company-access";
const rows=[
 {companyId:"A",userId:"u",role:"FINANCE_OFFICER_AP",isActive:true,revokedAt:null},
 {companyId:"A",userId:"u",role:"FINANCE_CONTROLLER",isActive:true,revokedAt:null},
 {companyId:"B",userId:"u",role:"CFO",isActive:true,revokedAt:null},
 {companyId:"A",userId:"x",role:"CEO",isActive:true,revokedAt:null},
];
const resource={kind:"DOCTYPE" as const,name:"SUPPLIER_BILL" as const};
test("same user has multiple roles but they remain company-scoped",()=>{
 assert.deepEqual(effectiveCompanyRoles(rows,"u","A"),["FINANCE_OFFICER_AP","FINANCE_CONTROLLER"]);
 assert.deepEqual(effectiveCompanyRoles(rows,"u","B"),["CFO"]);
 assert.deepEqual(effectiveCompanyRoles(rows,"u","C"),[]);
});
test("explicit deny blocks selected privilege while keeping other roles",()=>{
 assert.equal(canAccessCompanyResource(rows,[],{userId:"u",companyId:"A"},resource,"CREATE"),true);
 assert.equal(canAccessCompanyResource(rows,[{companyId:"A",role:"FINANCE_OFFICER_AP",resourceKind:"DOCTYPE",resourceName:"SUPPLIER_BILL",action:"CREATE",allowed:false}],{userId:"u",companyId:"A"},resource,"CREATE"),false);
});
test("override cannot create permissions outside baseline",()=>{
 assert.equal(canAccessCompanyResource(rows,[{companyId:"A",role:"FINANCE_OFFICER_AP",resourceKind:"DOCTYPE",resourceName:"SUPPLIER_BILL",action:"POST",allowed:true}],{userId:"u",companyId:"A"},resource,"REVERSE"),false);
});
test("revoked or inactive users have no role",()=>{
 assert.deepEqual(effectiveCompanyRoles([{...rows[0],revokedAt:new Date()}],"u","A"),[]);
 assert.deepEqual(effectiveCompanyRoles([{...rows[0],isActive:false}],"u","A"),[]);
});
