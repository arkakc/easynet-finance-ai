import test from "node:test";
import assert from "node:assert/strict";
import {validateRecoveryTarget} from "../../lib/erp/recovery-resolution";
test("only exactly one matching active target permits reconciliation",()=>{
 assert.doesNotThrow(()=>validateRecoveryTarget("Q1",[{id:"SO1",sourceDocumentId:"Q1",status:"DRAFT"}],"SO1"));
});
test("missing or duplicate targets cannot close conversion claims",()=>{
 assert.throws(()=>validateRecoveryTarget("Q1",[],"SO1"),/exactly one/);
 assert.throws(()=>validateRecoveryTarget("Q1",[{id:"SO1",sourceDocumentId:"Q1"},{id:"SO2",sourceDocumentId:"Q1"}],"SO1"),/exactly one/);
});
test("unlinked and cancelled targets cannot close conversion claims",()=>{
 assert.throws(()=>validateRecoveryTarget("Q1",[{id:"SO1",sourceDocumentId:"Q2"}],"SO1"),/mismatch/);
 assert.throws(()=>validateRecoveryTarget("Q1",[{id:"SO1",sourceDocumentId:"Q1",status:"CANCELLED"}],"SO1"),/exactly one/);
});
