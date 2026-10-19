import "server-only";
import { prisma } from "@/src/lib/prisma";
import { getValidatedRequestUser } from "@/lib/auth";
import { canAccessCompanyResource, type ScopedAssignment, type ScopedOverride } from "./erp-company-access";
import type { PrivilegeAction, PrivilegeResource } from "./erp-role-privileges";

/** A company identifier in a request is only a selector; it does not convey membership.
 * All grants are fetched from database by the current validated session user.
 */
export async function getValidatedCompanyAccess(request: Request, companyId: string) {
  const user=await getValidatedRequestUser(request);
  if (!user?.userId) throw new Error("Unauthorized");
  if (!companyId?.trim()) throw new Error("Company context required");
  const assignments=await prisma.erpUserRoleAssignment.findMany({
    where:{userId:user.userId,companyId,isActive:true,revokedAt:null},
    select:{userId:true,companyId:true,role:true,isActive:true,revokedAt:true},
  });
  if (!assignments.length) throw new Error("Forbidden");
  const overrides=await prisma.erpCompanyPrivilegeOverride.findMany({
    where:{companyId,role:{in:assignments.map(a=>a.role)}},
    select:{companyId:true,role:true,resourceKind:true,resourceName:true,action:true,allowed:true},
  });
  return {user,companyId,assignments:assignments as ScopedAssignment[],overrides:overrides as ScopedOverride[]};
}

export async function requireErpResourcePermission(
  request: Request, companyId: string, resource: PrivilegeResource, action: PrivilegeAction,
) {
  const context=await getValidatedCompanyAccess(request,companyId);
  if (!canAccessCompanyResource(context.assignments,context.overrides,
    {userId:context.user.userId!,companyId:context.companyId},resource,action)) {
    throw new Error("Forbidden");
  }
  return context;
}
