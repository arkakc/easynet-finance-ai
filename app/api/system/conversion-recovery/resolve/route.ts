import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { findRecords } from "@/lib/backend/apps-script";
import { validateRecoveryTarget } from "@/lib/erp/recovery-resolution";
import { recoveryEvidenceHash } from "@/lib/erp/recovery-evidence";
export const runtime="nodejs";
const schema=z.object({claimId:z.string().min(1),targetId:z.string().trim().min(1),evidence:z.string().trim().min(40).max(2000)});
const supported:Record<string,{table:string,id:string,lineTable:string,lineFk:string}>={
 salesQuoteToOrder:{table:"Quotes",id:"quoteId",lineTable:"QuoteLines",lineFk:"quoteId"},
 supplierQuoteToPo:{table:"PurchaseOrders",id:"poId",lineTable:"POLines",lineFk:"poId"},
 quoteToInvoice:{table:"Invoices",id:"invoiceId",lineTable:"InvoiceLines",lineFk:"invoiceId"},
 purchaseOrderToBill:{table:"SupplierBills",id:"billId",lineTable:"SupplierBillLines",lineFk:"billId"},
};
export async function POST(request:Request){
 try{
  const actor=await requirePermission("settings.manage");
  const input=schema.parse(await request.json());
  const claim=await prisma.approvalRequest.findFirst({where:{id:input.claimId,type:"ERP_CONVERSION_IDEMPOTENCY",status:"IN_REVIEW"}});
  if(!claim||!claim.documentCode||!claim.documentType)return NextResponse.json({ok:false,error:"In-review claim not found"},{status:404});
  const config=supported[claim.documentType];
  if(!config)return NextResponse.json({ok:false,error:"Conversion type requires manual engineering reconciliation; cannot automatically close"},{status:409});
  const reviewer=await prisma.user.findUnique({where:{email:actor.email},select:{id:true}});
  if(!reviewer)return NextResponse.json({ok:false,error:"Reviewer not found"},{status:403});
  const targetRows=await findRecords<Record<string,unknown>>(config.table,{sourceDocumentId:claim.documentCode},50);
  if(targetRows.rows.length===50)return NextResponse.json({ok:false,error:"Target search truncated; reconciliation refused"},{status:409});
  const candidates=targetRows.rows.map(row=>({id:row[config.id],sourceDocumentId:row.sourceDocumentId,status:row.status,journalId:row.journalId}));
  validateRecoveryTarget(claim.documentCode,candidates,input.targetId);
  const target=targetRows.rows.find(row=>String(row[config.id])===input.targetId);
  if(!target||String(target.status||"").toUpperCase()!=="DRAFT"||String(target.journalId||"").trim()){
   return NextResponse.json({ok:false,error:"Only one unposted DRAFT target can be reconciled here; inspect posted GL journals manually"},{status:409});
  }
  const lines=await findRecords<Record<string,unknown>>(config.lineTable,{[config.lineFk]:input.targetId},500);
  if(!lines.rows.length||lines.rows.length===500)return NextResponse.json({ok:false,error:"Target lines missing or truncated; resolution refused"},{status:409});
  const hash=recoveryEvidenceHash(claim.code,input.evidence,actor.email);
  const result=await prisma.$transaction(async tx=>{
   const updated=await tx.approvalRequest.updateMany({where:{id:claim.id,status:"IN_REVIEW",type:"ERP_CONVERSION_IDEMPOTENCY"},data:{status:"APPROVED",approvedAt:new Date(),approverComment:"Verified existing unposted target "+input.targetId+"; evidence SHA-256 "+hash+"; no retry permitted"}});
   if(updated.count!==1)return updated.count;
   await tx.auditLog.create({data:{action:"RESOLVE",entityType:"ERP_CONVERSION_RECOVERY",entityCode:claim.code,description:"Existing unposted target reconciled; claim permanently closed without retry",changes:JSON.stringify({source:claim.documentCode,kind:claim.documentType,targetId:input.targetId,lines:lines.rows.length,evidenceHash:hash,retryAllowed:false}),userId:reviewer.id}});
   return updated.count;
  });
  if(result!==1)return NextResponse.json({ok:false,error:"Claim changed during reconciliation"},{status:409});
  return NextResponse.json({ok:true,status:"APPROVED",targetId:input.targetId,retryAllowed:false,evidenceHash:hash});
 }catch(e){
  const msg=e instanceof z.ZodError?e.issues.map(i=>i.message).join("; "):e instanceof Error?e.message:"Resolution failed";
  return NextResponse.json({ok:false,error:msg},{status:msg==="Unauthorized"?401:msg==="Forbidden"?403:e instanceof z.ZodError?400:409});
 }
}
