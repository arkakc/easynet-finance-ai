import { createHash,randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";
import { POST as allocate } from "@/app/api/erp/advance-allocation/route";
import { appendAuditEvent } from "@/lib/security/audit";
export const dynamic="force-dynamic";
const schema=z.object({
 action:z.literal("allocateCustomerAdvances"),
 confirm:z.literal(true),
 allocations:z.array(z.object({paymentId:z.string().trim().min(1),invoiceId:z.string().trim().min(1),amount:z.number().finite().positive(),allocationDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)})).min(1).max(20),
});
export async function POST(request:Request){
 try{
  await requirePermission("sales.write");
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(e=>e.message).join("; ")},{status:400});
  const batchId=randomUUID();
  const results:Array<{paymentId:string;invoiceId:string;status:"allocated"|"blocked"|"failed";message:string}>=[];
  for(const row of parsed.data.allocations){
   const {paymentId,invoiceId,amount,allocationDate}=row;
   try{
    const date=new Date(allocationDate+"T00:00:00Z");
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==allocationDate){results.push({paymentId,invoiceId,status:"blocked",message:"Invalid allocation date"});continue;}
    const [p,i]=await Promise.all([findRecords<any>("Payments",{paymentId},1),findRecords<any>("Invoices",{invoiceId},1)]);
    const payment=p.rows[0],invoice=i.rows[0];
    if(!payment||!invoice){results.push({paymentId,invoiceId,status:"blocked",message:"Payment or invoice missing"});continue;}
    if(String(payment.partyType)!=="Customer"||String(payment.partyId||payment.customerId||"")!==String(invoice.customerId||"")){
      results.push({paymentId,invoiceId,status:"blocked",message:"Customer mismatch; allocation rejected"});continue;
    }
    if(!["POSTED","PAID","PARTLY_PAID"].includes(String(invoice.status||"").toUpperCase())||String(invoice.invoiceNumber||"").toUpperCase().startsWith("CN-")){
      results.push({paymentId,invoiceId,status:"blocked",message:"Target must be a posted Sales Invoice"});continue;
    }
    if(!String(payment.journalId||"").trim()){results.push({paymentId,invoiceId,status:"blocked",message:"Payment has not been financially finalized"});continue;}
    const key="BULK-ADV:"+createHash("sha256").update([paymentId,invoiceId,allocationDate,String(Math.round(amount*100))].join("|")).digest("hex");
    const response=await allocate(new Request("http://localhost/api/erp/advance-allocation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      paymentId,partyType:"Customer",againstDocumentType:"Sales Invoice",againstDocumentId:invoiceId,amount,allocationDate,idempotencyKey:key,
    })}));
    const data=await response.json();
    if(!response.ok||!data.ok){results.push({paymentId,invoiceId,status:"failed",message:String(data.error||"Allocation failed; reconcile before retry")});continue;}
    results.push({paymentId,invoiceId,status:"allocated",message:"Allocation service accepted the posting"});
   }catch(e){results.push({paymentId,invoiceId,status:"failed",message:e instanceof Error?e.message:"Outcome uncertain; reconcile before retry"});}
  }
  const auditFailures:string[]=[];
  for(const result of results){
   try{await appendAuditEvent({action:"BULK_ALLOCATE",entityType:"CustomerAdvanceAllocation",entityId:result.paymentId,entityCode:result.invoiceId,
    description:result.message,metadata:{batchId,status:result.status},outcome:result.status==="allocated"?"SUCCESS":result.status==="blocked"?"DENIED":"FAILURE"});}
   catch(e){auditFailures.push(result.paymentId);console.error("bulk-allocation.audit-error",{batchId,error:e});}
  }
  return NextResponse.json({ok:true,batchId,results,auditWarning:auditFailures.length?"Some audit events failed; preserve results for reconciliation.":null});
 }catch(e){const m=e instanceof Error?e.message:"Bulk allocation failed";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:400});}
}
