import assert from "node:assert/strict";
import test from "node:test";
import {resolveFormAccess} from "../../lib/workflow/erp-form-permissions";
test("draft owner may edit and submit only when granted",()=>{
 const a=resolveFormAccess(["READ","EDIT_DRAFT","SUBMIT"],"DRAFT",true);
 assert.equal(a.canEditDraft,true);assert.equal(a.canSubmit,true);assert.equal(a.canApprove,false);
});
test("posted and non-draft documents cannot be edited or deleted",()=>{
 const a=resolveFormAccess(["READ","EDIT_DRAFT","DELETE_DRAFT","SUBMIT"],"POSTED",true);
 assert.equal(a.canEditDraft,false);assert.equal(a.canDeleteDraft,false);assert.equal(a.canSubmit,false);
});
test("creator cannot approve even if role permits",()=>{
 assert.equal(resolveFormAccess(["APPROVE"],"UNDER_REVIEW",true).canApprove,false);
 assert.equal(resolveFormAccess(["APPROVE"],"UNDER_REVIEW",false).canApprove,true);
});
test("posting requires approved status",()=>{
 assert.equal(resolveFormAccess(["POST"],"UNDER_REVIEW",false).canPost,false);
 assert.equal(resolveFormAccess(["POST"],"APPROVED",false).canPost,true);
});
