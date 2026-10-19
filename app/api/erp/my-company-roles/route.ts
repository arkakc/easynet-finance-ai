import { NextResponse } from "next/server";
import { getValidatedRequestUser } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { ERP_ROLES } from "@/lib/workflow/erp-approval-policy";

/** Read only: discover only companies the current authenticated user belongs to. */
export async function GET(request:Request) {
  try {
    const user=await getValidatedRequestUser(request);
    if (!user?.userId) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
    const grants=await prisma.erpUserRoleAssignment.findMany({
      where:{userId:user.userId,isActive:true,revokedAt:null,role:{in:[...ERP_ROLES]}},
      select:{companyId:true,role:true},
      orderBy:[{companyId:"asc"},{role:"asc"}],
    });
    const companies=Array.from(new Set(grants.map(x=>x.companyId))).map(companyId=>({
      companyId,roles:grants.filter(x=>x.companyId===companyId).map(x=>x.role),
    }));
    return NextResponse.json({ok:true,companies},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({ok:false,error:"Could not load company roles"},{status:500,headers:{"Cache-Control":"no-store"}});
  }
}
