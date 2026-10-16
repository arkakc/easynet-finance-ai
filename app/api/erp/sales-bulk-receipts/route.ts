import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { POST as erpTransactions } from "@/app/api/erp/transactions/route";
import { appendAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
type Payment = {paymentId?:string;paymentNumber?:string;partyType?:string;paymentType?:string;status?:string;journalId?:string;partyId?:string;customerId?:string;amount?:number;paymentDate?:string;cashBankAccountId?:string;paymentMethod?:string;reference?:string;againstDocumentId?:string};
const schema=z.object({
 action:z.literal("finalizeApprovedCustomerReceipts"),
 paymentIds:z.array(z.string().trim().min(1)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,"Duplicate payment IDs"),
 confirmation:z.literal("FINALIZE RECEIPTS"),
});
function check(row?:Payment){
 if(!row) return {eligible:false,reason:"Payment missing"};
 if(String(row.partyType||"")!=="Customer")return {eligible:false,reason:"Not a customer payment"};
 if(String(row.paymentType||"").toUpperCase()==="PAY")return {eligible:false,reason:"Customer refund is not a receipt"};
 if(String(row.journalId||"").trim())return {eligible:false,reason:"Already finalized: journal exists"};
 if(String(row.status||"").toUpperCase()!=="APPROVED")return {eligible:false,reason:"Payment must be APPROVED"};
 if(!(Number(row.amount||0)>0))return {eligible:false,reason:"Amount must be positive"};
 if(!String(row.paymentDate||"").trim()||!String(row.paymentMethod||"").trim()||!String(row.cashBankAccountId||"").trim())return {eligible:false,reason:"Date, method and bank account required"};
 return {eligible:true,reason:"Ready for final validation"};
}
export async function GET(){
 try{
  await requirePermission("sales.write");
  const results=await listTable<Payment>("Payments",500,0);
  return NextResponse.json({ok:true,payments:(results.rows||[]).filter(row=>String(row.partyType||"")==="Customer"&&String(row.paymentType||"").toUpperCase()!=="PAY").map(row=>({
   paymentId:String(row.paymentId||""),paymentNumber:String(row.paymentNumber||""),customer:String(row.partyId||row.customerId||""),
   status:String(row.status||""),amount:Number(row.amount||0),paymentDate:String(row.paymentDate||""),bankAccount:String(row.cashBankAccountId||""),reference:String(row.reference||""),...check(row)
  })),limit:20});
 }catch(e){const message=e instanceof Error?e.message:"Receipt preview failed";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:500});}
}
export async function POST(request:Request){
 try{
  await requirePermission("sales.write");
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(issue=>issue.message).join("; ")},{status:400});
  const batchId=randomUUID();
  const results:Array<{paymentId:string;number:string;status:"finalized"|"blocked"|"failed";message:string}>=[];
  for(const paymentId of parsed.data.paymentIds){
   let number="";
   try{
    const row=(await findRecords<Payment>("Payments",{paymentId},1)).rows[0];
    number=String(row?.paymentNumber||"");
    const eligibility=check(row);
    if(!eligibility.eligible){results.push({paymentId,number,status:"blocked",message:eligibility.reason});continue;}
    // No synthetic receipt or mutable payment details: the existing approved record is the sole source.
    const response=await erpTransactions(new Request("http://localhost/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"finalizePayment",payload:{paymentId}})}));
    const payload=await response.json();
    if(!response.ok||!payload.ok){results.push({paymentId,number,status:"failed",message:String(payload.error||"Finalization failed; reconcile before retry")});continue;}
    const finalized=payload.result;
    results.push({paymentId,number,status:finalized?.alreadyFinalized?"blocked":"finalized",message:finalized?.alreadyFinalized?"Payment already finalized by another operation":"Finalized with journal "+String(finalized?.journalId||"")});
   }catch(e){results.push({paymentId,number,status:"failed",message:e instanceof Error?e.message:"Outcome uncertain; reconcile before retry"});}
  }
  const auditFailures:string[]=[];
  for(const result of results)try{
   await appendAuditEvent({action:"BULK_RECEIPT_FINALIZE",entityType:"CustomerReceiptBatch",entityId:result.paymentId,entityCode:result.number,
    description:result.message,metadata:{batchId,result:result.status},outcome:result.status==="finalized"?"SUCCESS":result.status==="blocked"?"DENIED":"FAILURE"});
  }catch(e){auditFailures.push(result.paymentId);console.error("bulk.receipt.audit-failed",{batchId,error:e});}
  return NextResponse.json({ok:true,batchId,results,auditWarning:auditFailures.length?"Some audit records failed; retain the batch results for reconciliation.":null});
 }catch(e){const message=e instanceof Error?e.message:"Bulk receipt finalization failed";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:400});}
}
