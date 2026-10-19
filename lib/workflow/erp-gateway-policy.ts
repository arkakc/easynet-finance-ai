import type { PrivilegeAction, PrivilegeResource } from "./erp-role-privileges";

/** Only exact, unambiguous ERP action targets can be mapped to role grants.
 * Other legacy targets continue using their pre-existing validated permission.
 */
export type ErpGatewayTarget = "approvals" | "stock" | "journalReverse";
export function approvalResource(
  target: string, body: Record<string,unknown>,
): {resource: PrivilegeResource; action: PrivilegeAction} | null {
  if (target === "journalReverse") return {resource:{kind:"DOCTYPE",name:"MANUAL_JOURNAL"},action:"REVERSE"};
  if (target === "stock") return null; // mixed stock operations need subtype-specific resource mapping
  if (target !== "approvals") return null;
  const payload=(body.payload && typeof body.payload==="object" && !Array.isArray(body.payload))
    ? body.payload as Record<string,unknown> : {};
  const document = String(payload.recordType||"");
  const map: Record<string,PrivilegeResource> = {
    invoice:{kind:"DOCTYPE",name:"SALES_INVOICE"},
    supplierBill:{kind:"DOCTYPE",name:"SUPPLIER_BILL"},
    purchaseOrder:{kind:"DOCTYPE",name:"PURCHASE_ORDER"},
  };
  const resource=map[document];
  if (!resource) return null;
  const decision=String(payload.decision||"");
  if (decision==="APPROVE") return {resource,action:"APPROVE"};
  if (decision==="CANCEL") return {resource,action:"DELETE_DRAFT"};
  return null;
}
