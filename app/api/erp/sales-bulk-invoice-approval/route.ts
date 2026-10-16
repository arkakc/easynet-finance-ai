import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { listTable, findRecords } from "@/lib/backend/apps-script";
import { env } from "@/lib/env";
import { POST as approveInvoice } from "@/app/api/approvals/route";
import { appendAuditEvent } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
 action: z.literal("approveAndPostInvoices"),
 invoiceIds: z.array(z.string().trim().min(1)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,"Duplicate invoice IDs"),
 confirmation: z.literal("APPROVE AND POST"),
 note: z.string().trim().min(8).max(500),
});
type Invoice = {invoiceId?:string;invoiceNumber?:string;customerId?:string;status?:string;totalAmount?:number;gstAmount?:number;journalId?:string};
const allowed=(row:Invoice)=>String(row.status||"").toUpperCase()==="DRAFT" && !String(row.invoiceNumber||"").toUpperCase().startsWith("CN-") && !String(row.journalId||"").trim();
export async function GET(){
 try{
  await requirePermission("post.approve");
  const result=await listTable<Invoice>("Invoices",500,0);
  return NextResponse.json({ok:true,invoices:(result.rows||[]).filter(row=>!String(row.invoiceNumber||"").toUpperCase().startsWith("CN-")).map(row=>({
   invoiceId:String(row.invoiceId||""),invoiceNumber:String(row.invoiceNumber||""),customerId:String(row.customerId||""),
   status:String(row.status||""),totalAmount:Number(row.totalAmount||0),gstAmount:Number(row.gstAmount||0),
   eligible:allowed(row),reason:allowed(row)?"Ready for controller review":"Only unposted draft Sales Invoices are eligible",
  })),limit:20});
 }catch(error){const m=error instanceof Error?error.message:"Unable to load invoice approvals";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:500});}
}
export async function POST(request:Request){
 try{
  await requirePermission("post.approve");
  const parsed=inputSchema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(e=>e.message).join("; ")},{status:400});
  if(!env.APP_SECRET)return NextResponse.json({ok:false,error:"Application approval secret is not configured"},{status:503});
  const {invoiceIds,note}=parsed.data;
  const batchId=randomUUID();
  const results:Array<{sourceId:string;status:"posted"|"blocked"|"failed";documentNumber:string;message:string}>=[];
  for(const sourceId of invoiceIds){
   let documentNumber="";
   try{
    const row=(await findRecords<Invoice>("Invoices",{invoiceId:sourceId},1)).rows[0];
    documentNumber=String(row?.invoiceNumber||"");
    if(!row||!allowed(row)){results.push({sourceId,documentNumber,status:"blocked",message:"Invoice is missing, posted, or no longer an eligible draft"});continue;}
    const review=await prisma.approvalRequest.findFirst({where:{type:"PHASE3_INVOICE_REVIEW",documentCode:sourceId},orderBy:{createdAt:"desc"},select:{status:true}});
    if(review&&["PENDING","IN_REVIEW"].includes(review.status)){results.push({sourceId,documentNumber,status:"blocked",message:"Submitted maker-checker review is pending; complete it through the review workflow"});continue;}
    const response=await approveInvoice(new Request("http://localhost/api/approvals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      secret:env.APP_SECRET,payload:{recordType:"invoice",recordId:sourceId,decision:"APPROVE",note},
    })}));
    const output=await response.json();
    if(!response.ok||!output.ok){results.push({sourceId,documentNumber,status:"failed",message:String(output.error||"Approval or posting failed; reconcile before retrying")});continue;}
    results.push({sourceId,documentNumber,status:"posted",message:"Invoice approved and processed. Final status: "+String(output.status||"unknown")});
   }catch(error){results.push({sourceId,documentNumber,status:"failed",message:error instanceof Error?error.message:"Posting outcome uncertain; reconcile before retry"});}
  }
  const auditErrors:string[]=[];
  for(const row of results){
   try{await appendAuditEvent({action:"BULK_APPROVE_POST",entityType:"SalesInvoiceBulkPosting",entityId:row.sourceId,entityCode:row.documentNumber,
     description:row.message,metadata:{batchId,status:row.status,note},outcome:row.status==="posted"?"SUCCESS":row.status==="blocked"?"DENIED":"FAILURE"});}
   catch(e){auditErrors.push(row.sourceId);console.error("bulk-invoice-posting.audit-error",{batchId,sourceId:row.sourceId,error:e});}
  }
  return NextResponse.json({ok:true,batchId,results,auditWarning:auditErrors.length?"Some audit events failed. Preserve these results and contact an administrator.":null});
 }catch(error){const m=error instanceof Error?error.message:"Bulk invoice posting failed";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:400});}
}
