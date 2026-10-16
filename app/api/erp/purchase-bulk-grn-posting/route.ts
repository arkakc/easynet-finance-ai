import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { POST as postReceipt } from "@/app/api/erp/purchase-receipt/route";
import { appendAuditEvent } from "@/lib/security/audit";

export const dynamic="force-dynamic";
const lineSchema=z.object({itemId:z.string().trim().min(1),qty:z.number().finite().positive()});
const rowSchema=z.object({receiptId:z.string().trim().min(1),warehouseId:z.string().trim().min(1),receiptDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),lines:z.array(lineSchema).min(1).max(100)});
const schema=z.object({action:z.literal("postGoodsReceipts"),confirmation:z.literal("POST GOODS RECEIPTS"),receipts:z.array(rowSchema).min(1).max(10).refine(rows=>new Set(rows.map(x=>x.receiptId)).size===rows.length,"Duplicate receipt ID")});
function readLines(raw:string|null){try{const rows=JSON.parse(raw||"[]");return Array.isArray(rows)?rows:[];}catch{return [];}}
export async function GET(){
 try{
  await requirePermission("post.approve");
  const receipts=await prisma.purchaseReceipt.findMany({where:{status:"DRAFT"},orderBy:{createdAt:"desc"},take:100,include:{purchaseOrder:{select:{code:true,supplier:{select:{name:true,code:true}}}}}});
  return NextResponse.json({ok:true,limit:10,receipts:receipts.map(r=>({id:r.id,number:r.code,orderNumber:r.purchaseOrder?.code||"",supplier:r.purchaseOrder?.supplier?.name||r.purchaseOrder?.supplier?.code||"",receiptDate:r.receiptDate.toISOString().slice(0,10),lines:readLines(r.items).map((l:any)=>({itemId:String(l.itemId||""),itemCode:String(l.itemCode||l.itemId||""),itemName:String(l.itemName||""),remainingQty:Number(l.remainingQty||0),qty:Number(l.qty||0)}))}))});
 }catch(e){const m=e instanceof Error?e.message:"Unable to load draft GRNs";return NextResponse.json({ok:false,error:m},{status:m==="Unauthorized"?401:m==="Forbidden"?403:500});}
}
export async function POST(request:Request){
 try{
  await requirePermission("post.approve");
  await requirePermission("purchase.write");
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(e=>e.message).join("; ")},{status:400});
  const batchId=randomUUID();
  const results:Array<{receiptId:string;number:string;status:"posted"|"blocked"|"failed";message:string;journalId?:string}>=[];
  for(const input of parsed.data.receipts){
   let number="";
   try{
    const date=new Date(input.receiptDate+"T00:00:00Z");
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.receiptDate){results.push({receiptId:input.receiptId,number,status:"blocked",message:"Invalid accounting date"});continue;}
    if(new Set(input.lines.map(l=>l.itemId)).size!==input.lines.length){results.push({receiptId:input.receiptId,number,status:"blocked",message:"Duplicate item on receipt"});continue;}
    const receipt=await prisma.purchaseReceipt.findUnique({where:{id:input.receiptId}});
    number=receipt?.code||"";
    if(!receipt||receipt.status!=="DRAFT"||receipt.journalId){results.push({receiptId:input.receiptId,number,status:"blocked",message:"GRN missing, already posted, or not a draft"});continue;}
    const stored=readLines(receipt.items);
    if(input.lines.some(line=>!stored.some((saved:any)=>String(saved.itemId)===line.itemId))){results.push({receiptId:input.receiptId,number,status:"blocked",message:"Submitted items differ from approved draft"});continue;}
    if(input.lines.some(line=>{const saved=stored.find((x:any)=>String(x.itemId)===line.itemId);return line.qty>Number(saved?.remainingQty||0)+0.0001;})){results.push({receiptId:input.receiptId,number,status:"blocked",message:"Receipt quantity exceeds draft remaining quantity"});continue;}
    // The existing receipt service performs authoritative remaining PO quantity, warehouse,
    // accounting period and atomic stock / GRNI posting checks.
    const response=await postReceipt(new Request("http://localhost/api/erp/purchase-receipt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approve",receiptId:input.receiptId,warehouseId:input.warehouseId,receiptDate:input.receiptDate,lines:input.lines})}));
    const data=await response.json();
    if(!response.ok||!data.ok){results.push({receiptId:input.receiptId,number,status:"failed",message:String(data.error||"GRN posting failed; reconcile before retry")});continue;}
    results.push({receiptId:input.receiptId,number,status:data.existing?"blocked":"posted",message:String(data.message||"Goods Receipt posted"),journalId:String(data.purchaseReceipt?.journalId||"")});
   }catch(e){results.push({receiptId:input.receiptId,number,status:"failed",message:e instanceof Error?e.message:"Posting outcome uncertain; reconcile before retry"});}
  }
  const auditFailures:string[]=[];
  for(const row of results)try{await appendAuditEvent({action:"BULK_GRN_POST",entityType:"PurchaseReceiptBatch",entityId:row.receiptId,entityCode:row.number,description:row.message,metadata:{batchId,status:row.status,journalId:row.journalId||null},outcome:row.status==="posted"?"SUCCESS":row.status==="blocked"?"DENIED":"FAILURE"});}catch(e){auditFailures.push(row.receiptId);console.error("purchase.bulk-grn.audit-failed",{batchId,error:e});}
  return NextResponse.json({ok:true,batchId,results,auditWarning:auditFailures.length?"Audit write failures occurred; preserve the results and reconcile.":null});
 }catch(e){const m=e instanceof Error?e.message:"Bulk GRN posting failed";return NextResponse.json({ok:false,error:m},{status:m==="Unauthorized"?401:m==="Forbidden"?403:400});}
}
