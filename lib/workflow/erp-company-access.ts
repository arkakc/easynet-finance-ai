import { ERP_ROLES, type ErpRole } from "./erp-approval-policy";
import { hasErpPrivilege, type PrivilegeAction, type PrivilegeResource } from "./erp-role-privileges";

export type ScopedAssignment = {
  companyId: string; userId: string; role: string; isActive: boolean; revokedAt: Date | null;
};
export type ScopedOverride = {
  companyId: string; role: string; resourceKind: string; resourceName: string;
  action: string; allowed: boolean;
};
const ROLE_VALUES = new Set<string>(ERP_ROLES);
export function effectiveCompanyRoles(
  assignments: readonly ScopedAssignment[], userId: string, companyId: string,
): ErpRole[] {
  if (!userId || !companyId) return [];
  return Array.from(new Set(assignments
    .filter(row=>row.userId===userId && row.companyId===companyId && row.isActive && !row.revokedAt && ROLE_VALUES.has(row.role))
    .map(row=>row.role as ErpRole)));
}

/** An explicit deny always wins. An allow cannot grant an action missing from
 * the canonical catalogue. This prevents overrides from bypassing segregation.
 */
export function canAccessCompanyResource(
  assignments: readonly ScopedAssignment[],
  overrides: readonly ScopedOverride[],
  actor: { userId: string; companyId: string },
  resource: PrivilegeResource,
  action: PrivilegeAction,
): boolean {
  const roles=effectiveCompanyRoles(assignments,actor.userId,actor.companyId);
  if (!roles.length || !hasErpPrivilege(roles,resource,action)) return false;
  const key=(role:string)=>overrides.find(x=>x.companyId===actor.companyId && x.role===role
    && x.resourceKind===resource.kind && x.resourceName===resource.name && x.action===action);
  return roles.some(role=>hasErpPrivilege([role],resource,action) && key(role)?.allowed!==false);
}
