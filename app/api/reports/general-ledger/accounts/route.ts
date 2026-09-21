import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

export async function GET(){
 try{
  await requirePermission("reports.read");
  const accounts=await prisma.chartOfAccounts.findMany({
    where:{isActive:true},
    orderBy:{code:"asc"},
    include:{
      children:{select:{id:true}},
      journalLines:{where:{journal:{status:"POSTED"}},select:{debit:true,credit:true}},
    },
  });
  return NextResponse.json({ok:true,accounts:accounts.filter(a=>a.children.length===0).map(a=>{
    const raw=a.journalLines.reduce((sum,l)=>sum+Number(l.debit||0)-Number(l.credit||0),0);
    const creditNormal=["LIABILITY","CONTRA_LIABILITY","EQUITY","REVENUE"].includes(String(a.type));
    return {id:a.id,code:a.code,name:a.name,type:a.type,balance:creditNormal?-raw:raw};
  })});
 }catch(error){const message=error instanceof Error?error.message:"Accounts could not be loaded";return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});}
}