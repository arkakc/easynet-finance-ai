import { createHash } from "node:crypto";
export function recoveryEvidenceHash(claimCode:string, note:string, operator:string){
 if(!claimCode.startsWith("CONVERSION:")||!/^[a-f0-9]{64}$/.test(claimCode.slice(11)))throw new Error("Invalid conversion claim");
 if(note.trim().length<20||note.length>2000)throw new Error("Recovery evidence must contain 20–2000 characters");
 if(!operator.trim())throw new Error("Reviewer required");
 return createHash("sha256").update(JSON.stringify({claimCode,note:note.trim(),operator:operator.trim()})).digest("hex");
}
