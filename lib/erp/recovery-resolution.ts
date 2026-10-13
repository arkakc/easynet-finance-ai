export type RecoveryTarget = { id?:unknown; sourceDocumentId?:unknown; status?:unknown };
export function validateRecoveryTarget(sourceId:string, candidates:RecoveryTarget[], targetId:string):void {
 const active=candidates.filter(r=> !["CANCELLED","REVERSED"].includes(String(r.status||"").toUpperCase()));
 if(active.length!==1)throw new Error("Recovery requires exactly one non-cancelled linked target; leave claim blocked");
 const candidate=active[0];
 if(String(candidate.sourceDocumentId||"")!==sourceId||String(candidate.id||"")!==targetId)throw new Error("Target/source identity mismatch; leave claim blocked");
}
