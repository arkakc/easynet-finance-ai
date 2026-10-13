export type BackupEvidence = { verifiedAt?:string; restoreVerifiedAt?:string };
export function productionEvidenceChecks(evidence:BackupEvidence, now=new Date()) {
 const valid=(value?:string)=>{
  if(!value||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value))return false;
  const timestamp=new Date(value).getTime(),age=now.getTime()-timestamp;
  return Number.isFinite(timestamp)&&age>=0&&age<=24*60*60*1000;
 };
 return {backupFresh:valid(evidence.verifiedAt),restoreFresh:valid(evidence.restoreVerifiedAt)};
}
export function sqliteBackupReady(input:{createdAt:string;manifestPresent:boolean;checksum:string},now=new Date()){
 const age=now.getTime()-new Date(input.createdAt).getTime();
 return input.manifestPresent&&/^[a-f0-9]{64}$/i.test(input.checksum)&&Number.isFinite(age)&&age>=0&&age<=86400000;
}
