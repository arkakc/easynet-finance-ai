import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { POST as createReceipt } from "@/app/api/erp/purchase-receipt/route";
import { appendAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
const schema=z.object({action:z.literal("createDraftGoodsReceipts"),purchaseOrderIds:z.array(z.string().trim().min(1)).min(1).max(25).refine(ids=>new Set(ids).size===ids.length,"Duplicate Purchase Orders"),receiptDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),confirm:z.literal(true)});
const statuses=new Set(["SENT","PARTIAL_RECEIVED","RECEIVED","BILLED"]);
async function orders(){
 const [purchaseOrders,receipts]=await Promise.all([
  prisma.purchaseOrder.findMany({where:{code:{startsWith:"PO-"}},orderBy:{createdAt:"desc"},take:500,include:{supplier:{select:{code:true,name:true}},lines:{include:{item:true}}}}),
  prisma.purchaseReceipt.findMany({where:{status:"DRAFT"},select:{purchaseOrderId:true}}),
 ]);
 const drafted=new Set(receipts.map(r=>r.purchaseOrderId));
 return purchaseOrders.map(po=>{
  const status=String(po.status||"").toUpperCase();
  const hasStock=po.lines.some(line=>line.item?.type==="GOOD"&&Number(line.quantity||0)>0);
  const eligible=statuses.has(status)&&!drafted.has(po.id)&&hasStock;
  return {id:po.id,number:po.code,supplier:po.supplier?.name||po.supplier?.code||"",status,amount:Number(po.total||0),eligible,
   reason:drafted.has(po.id)?"Existing draft GRN must be reviewed":!statuses.has(status)?"Purchase Order not approved for receiving":!hasStock?"No stock items to receive":"Ready; remaining quantities checked on creation"};
 });
}
export async function GET(){
 try{await requirePermission("purchase.read");return NextResponse.json({ok:true,orders:await orders(),limit:25});}
 catch(e){const message=e instanceof Error?e.message:"Unable to load bulk receiving";return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});}
}
export async function POST(request:Request){
 try{
  await requirePermission("purchase.write");
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(e=>e.message).join("; ")},{status:400});
  const input=parsed.data,date=new Date(input.receiptDate+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.receiptDate)return NextResponse.json({ok:false,error:"Invalid receipt date"},{status:400});
  const batchId=randomUUID();
  const results:Array<{sourceId:string;status:"created"|"blocked"|"failed"|"existing";number?:string;createdId?:string;message:string}>=[];
  for(const sourceId of input.purchaseOrderIds){
   try{
    const source=(await orders()).find(o=>o.id===sourceId);
    if(!source){results.push({sourceId,status:"blocked",message:"Purchase Order missing or outside latest register"});continue;}
    if(!source.eligible){results.push({sourceId,status:"blocked",message:source.reason});continue;}
    const response=await createReceipt(new Request("http://localhost/api/erp/purchase-receipt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createDraft",purchaseOrderId:sourceId,receiptDate:input.receiptDate})}));
    const data=await response.json();
    if(!response.ok||!data.ok){results.push({sourceId,status:"failed",message:String(data.error||"Draft GRN creation failed; reconcile before retry")});continue;}
    results.push({sourceId,status:data.existing?"existing":"created",number:String(data.purchaseReceipt?.receiptNumber||""),createdId:String(data.purchaseReceipt?.receiptId||""),message:String(data.message||"Draft GRN created")});
   }catch(e){results.push({sourceId,status:"failed",message:e instanceof Error?e.message:"Outcome uncertain; reconcile before retry"});}
  }
  const auditFailures:string[]=[];
  for(const result of results)try{
   await appendAuditEvent({action:"BULK_CONVERT",entityType:"PurchaseOrderToDraftGRN",entityId:result.sourceId,entityCode:result.number||null,description:result.message,
    metadata:{batchId,destinationId:result.createdId||null,result:result.status},outcome:result.status==="created"||result.status==="existing"?"SUCCESS":result.status==="blocked"?"DENIED":"FAILURE"});
  }catch(e){auditFailures.push(result.sourceId);console.error("purchase.bulk-grn.audit-error",{batchId,error:e});}
  return NextResponse.json({ok:true,batchId,results,auditWarning:auditFailures.length?"Some audit records failed; preserve batch results.":null});
 }catch(e){const message=e instanceof Error?e.message:"Bulk GRN creation failed";return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});}
}
