import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { getValidatedRequestUser } from "@/lib/auth";
import { validateRoleGrant } from "@/lib/workflow/erp-role-admin-policy";

const schema=z.object({companyId:z.string().trim().min(1),userId:z.string().trim().min(1),role:z.string().trim().min(1),action:z.enum(["GRANT","REVOKE"])});
/** Controlled bootstrap: only the legacy System Manager can provision ERP roles.
 * Requires independently validated session, no self grants and audited changes.
 * Future multi-company administrators need separately authenticated memberships.
 */
export async function POST(request:Request) {
 try {
  const actor=await getValidatedRequestUser(request);
  if(!actor?.userId) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!actor.roles.includes("System Manager")) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const input=schema.parse(await request.json());
  const grant=validateRoleGrant({...input,actorUserId:actor.userId});
  const target=await prisma.user.findUnique({where:{id:grant.userId},select:{id:true,status:true}});
  if(!target || target.status!=="ACTIVE") return NextResponse.json({ok:false,error:"Target user must be active"},{status:400});
  const result=await prisma.$transaction(async tx=>{
   const row=await tx.erpUserRoleAssignment.upsert({
    where:{companyId_userId_role:grant},create:{...grant,grantedById:actor.userId!,isActive:input.action==="GRANT",revokedAt:input.action==="REVOKE"?new Date():null},
    update:{isActive:input.action==="GRANT",revokedAt:input.action==="REVOKE"?new Date():null,grantedById:actor.userId!,grantedAt:new Date()},
   });
   await tx.auditLog.create({data:{userId:actor.userId!,action:"ERP_ROLE_"+input.action,entityType:"ErpUserRoleAssignment",entityId:row.id,metadata:JSON.stringify({companyId:grant.companyId,userId:grant.userId,role:grant.role,action:input.action})}});
   await tx.user.update({where:{id:grant.userId},data:{sessionVersion:{increment:1}}});
   return {id:row.id,active:row.isActive};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  return NextResponse.json({ok:true,result},{headers:{"Cache-Control":"no-store"}});
 } catch(error) {
  const message=error instanceof Error?error.message:"Role update failed";
  return NextResponse.json({ok:false,error:message},{status:error instanceof z.ZodError?400:400});
 }
}
