import test from "node:test";
import assert from "node:assert/strict";
import { recoveryEvidenceHash } from "../../lib/erp/recovery-evidence";
const code = "CONVERSION:" + "a".repeat(64);
test("recovery evidence hash is stable and unique to operator and note",()=>{
 const a=recoveryEvidenceHash(code,"Checked source and target journal posting.", "admin@example.com");
 assert.equal(a.length,64);
 assert.equal(a,recoveryEvidenceHash(code,"Checked source and target journal posting.", "admin@example.com"));
 assert.notEqual(a,recoveryEvidenceHash(code,"Checked source and target journal posting.", "other@example.com"));
});
test("recovery rejects weak evidence and malformed claim references",()=>{
 assert.throws(()=>recoveryEvidenceHash(code,"done","admin"),/evidence/);
 assert.throws(()=>recoveryEvidenceHash("not-a-claim","Checked source and target journal posting.","admin"),/claim/);
});
