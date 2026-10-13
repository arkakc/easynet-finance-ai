import test from "node:test";
import assert from "node:assert/strict";
import {productionEvidenceChecks,sqliteBackupReady} from "../../lib/system/release-evidence";
const now=new Date("2026-10-13T10:00:00Z");
test("PostgreSQL release needs recent backup AND restore evidence",()=>{
 const x=productionEvidenceChecks({verifiedAt:"2026-10-13T09:00:00Z",restoreVerifiedAt:"2026-10-13T09:30:00Z"},now);
 assert.deepEqual(x,{backupFresh:true,restoreFresh:true});
 assert.equal(productionEvidenceChecks({verifiedAt:"2026-10-13T09:00:00Z"},now).restoreFresh,false);
});
test("expired or future PostgreSQL evidence never passes",()=>{
 assert.equal(productionEvidenceChecks({verifiedAt:"2026-10-11T09:00:00Z"},now).backupFresh,false);
 assert.equal(productionEvidenceChecks({verifiedAt:"2026-10-14T09:00:00Z"},now).backupFresh,false);
});
test("SQLite backups missing a trusted manifest or checksum fail closed",()=>{
 const value={createdAt:"2026-10-13T09:00:00Z",manifestPresent:true,checksum:"a".repeat(64)};
 assert.equal(sqliteBackupReady(value,now),true);
 assert.equal(sqliteBackupReady({...value,manifestPresent:false},now),false);
 assert.equal(sqliteBackupReady({...value,checksum:""},now),false);
});
