import { ERP_ROLES, type ErpRole } from "./erp-approval-policy";

const VALID=new Set<string>(ERP_ROLES);
/** Role administration is deliberately limited to known canonical role IDs. */
export function validateRoleGrant(input:{companyId:string;userId:string;role:string;actorUserId:string}) {
  if(!input.companyId.trim() || !input.userId.trim() || !input.actorUserId.trim()) throw new Error("Missing role grant identity");
  if(!VALID.has(input.role)) throw new Error("Unknown ERP role");
  if(input.userId===input.actorUserId) throw new Error("Self-assignment is prohibited");
  return {companyId:input.companyId.trim(),userId:input.userId.trim(),role:input.role as ErpRole};
}
