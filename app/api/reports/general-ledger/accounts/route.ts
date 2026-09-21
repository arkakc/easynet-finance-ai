import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
export async function GET(){
 try{
  await requirePermission("reports.read");
  const accounts=await prisma.chartOfAccounts.findMany({where:{isActive:true},orderBy:{code:"asc"},select:{id:true,code:true,name:true}});
  return NextResponse.json({ok:true,accounts});
 }catch(error){const message=error instanceof Error?error.message:"Accounts could not be loaded";return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});}
}