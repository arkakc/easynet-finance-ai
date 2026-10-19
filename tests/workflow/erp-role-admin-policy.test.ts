import assert from "node:assert/strict";
import test from "node:test";
import {validateRoleGrant} from "../../lib/workflow/erp-role-admin-policy";
test("rejects self escalation",()=>{assert.throws(()=>validateRoleGrant({companyId:"c",userId:"u",role:"CFO",actorUserId:"u"}));});
test("rejects arbitrary role values",()=>{assert.throws(()=>validateRoleGrant({companyId:"c",userId:"u",role:"SYSTEM_MANAGER",actorUserId:"admin"}));});
test("valid grant preserves scoped identities",()=>{assert.equal(validateRoleGrant({companyId:"c",userId:"u",role:"FINANCE_OFFICER_AP",actorUserId:"admin"}).role,"FINANCE_OFFICER_AP");});
