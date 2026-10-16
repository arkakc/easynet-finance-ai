import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {requirePermission} from "@/lib/auth";
import {prisma} from "@/src/lib/prisma";
import {nextDocumentSeriesId} from "@/lib/accounting/document-numbering";
import {appendAuditEvent} from "@/lib/security/audit";
export const dynamic="force-dynamic";
const schema=z.object({action:z.literal("createMatchedSupplierBills"),purchaseOrderIds:z.array(z.string().trim().min(1)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,"Duplicate Purchase Orders"),confirmation:z.literal("CREATE DRAFT BILLS"),evidence:z.array(z.object({purchaseOrderId:z.string().min(1),invoiceNumber:z.string().trim().min(1).max(100),total:z.number().finite().positive(),gst:z.number().finite().min(0),documentId:z.string().min(1),lines:z.array(z.object({itemId:z.string().min(1),quantity:z.number().finite().positive(),unitPrice:z.number().finite().min(0),gst:z.number().finite().min(0)})).min(1)})).min(1).max(20)});
const epsilon=0.0001;
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
async function evaluate(ref:string){
 const order=await prisma.purchaseOrder.findFirst({where:{OR:[{id:ref},{code:ref}]},include:{supplier:{select:{name:true,code:true}},lines:{include:{item:{select:{type:true,code:true}}}}}});
 if(!order||!order.code.startsWith("PO-"))return {id:ref,number:ref,supplier:"",status:"UNKNOWN",eligible:false,reason:"Purchase Order not found",total:0,gst:0,lines:[]};
 const existing=await prisma.supplierBill.findFirst({where:{OR:[{orderId:order.id},{sourceDocId:order.id},{sourceDocId:order.code},{poReference:order.code}]}});
 const legacyReceipts=await prisma.purchaseReceipt.findMany({where:{purchaseOrderId:order.id,status:"POSTED"},select:{id:true,journalId:true}});
 const movements=await prisma.stockMovement.groupBy({by:["itemId"],where:{type:"PURCHASE_RECEIPT",referenceId:{in:[order.id,order.code]}},_sum:{quantity:true}});
 const received=new Map(movements.map(row=>[row.itemId,Number(row._sum.quantity||0)]));
 const purchaseLines=order.lines.filter(line=>line.item?.type==="GOOD"&&line.itemId);
 const totals=new Map<string,number>();
 for(const line of purchaseLines){const id=String(line.itemId);totals.set(id,(totals.get(id)||0)+Number(line.quantity));}
 const lines=[...totals.entries()].map(([itemId,ordered])=>{
 const matching=order.lines.filter(l=>l.itemId===itemId);
 const net=matching.reduce((n,l)=>n+Number(l.amount||0),0);
 const gst=matching.reduce((n,l)=>n+Number(l.taxAmount||0),0);
 return {itemId,ordered,received:received.get(itemId)||0,unitPrice:matching.length===1?Number(matching[0].unitPrice):null,net,gst};
});
 const statuses=["SENT","PARTIAL_RECEIVED","RECEIVED","BILLED"];
 let reason="";
 if(existing)reason="An existing Supplier Bill is linked to this Purchase Order";
 else if(!statuses.includes(String(order.status)))reason="Purchase Order is not approved for invoicing";
 else if(!purchaseLines.length)reason="No stock lines: service-only purchase orders require manual invoice review";
 else if(order.lines.some(line=>!line.itemId||line.item?.type!=="GOOD"))reason="Mixed stock/service or unresolved PO item requires manual invoice review";
 else if(!legacyReceipts.length||legacyReceipts.some(r=>!r.journalId))reason="Posted GRN with inventory/GRNI journal is required";
 else if(lines.some(line=>line.received+epsilon<line.ordered))reason="Partial Goods Receipt: full-PO draft converter is not permitted";
 else if(lines.some(line=>line.received>line.ordered+epsilon))reason="Over-receipt detected: reconcile warehouse stock";
 else if(Number(order.total)<=0)reason="Purchase Order total must be positive";
 return {id:order.id,number:order.code,supplier:order.supplier?.name||order.supplier?.code||"",status:String(order.status),eligible:!reason,reason:reason||"Quantities matched; supplier evidence required before conversion",total:Number(order.total),gst:Number(order.taxTotal),lines};
}
export async function GET(){
 try{await requirePermission("purchase.read");
 const orders=await prisma.purchaseOrder.findMany({where:{code:{startsWith:"PO-"}},select:{id:true},orderBy:{createdAt:"desc"},take:100});
 const rows=[];for(const order of orders)rows.push(await evaluate(order.id));
 return NextResponse.json({ok:true,orders:rows,limit:20,notice:"Full receipt matching only. Partial, mixed-service, price-variance and supplier invoice reference matching require separate review."});
 }catch(e){const m=e instanceof Error?e.message:"Matching preview failed";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:500});}
}
export async function POST(request:Request){
 try{await requirePermission("purchase.write");
 const parsed=schema.safeParse(await request.json());
 if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(x=>x.message).join("; ")},{status:400});
 const evidenceById=new Map(parsed.data.evidence.map(e=>[e.purchaseOrderId,e]));
 if(evidenceById.size!==parsed.data.purchaseOrderIds.length||parsed.data.purchaseOrderIds.some(id=>!evidenceById.has(id)))return NextResponse.json({ok:false,error:"Exactly one evidence record required per selected Purchase Order"},{status:400});
 const batchId=randomUUID();const results:Array<{sourceId:string;number:string;status:"created"|"blocked"|"failed";createdId?:string;documentNumber?:string;message:string}>=[];
 for(const sourceId of parsed.data.purchaseOrderIds){let number="";
  try{
   const check=await evaluate(sourceId);number=check.number;
   if(!check.eligible){results.push({sourceId,number,status:"blocked",message:check.reason});continue;}
   const ev=evidenceById.get(sourceId)!;
   if(money(ev.total)!==money(check.total)||money(ev.gst)!==money(check.gst)){results.push({sourceId,number,status:"blocked",message:"Supplier invoice amount or GST differs from PO; manual variance review required"});continue;}
   const linesById=new Map(ev.lines.map(line=>[line.itemId,line]));
   const sumGst=ev.lines.reduce((sum,line)=>sum+line.gst,0);
   if(money(sumGst)!==money(ev.gst)){results.push({sourceId,number,status:"blocked",message:"Supplier line GST does not sum to invoice GST"});continue;}
   if(linesById.size!==check.lines.length||ev.lines.length!==check.lines.length||check.lines.some(line=>{
     const v=linesById.get(line.itemId);
     return !v||Math.abs(v.quantity-line.ordered)>epsilon||line.unitPrice===null||money(v.unitPrice)!==money(line.unitPrice)||money(v.gst)!==money(line.gst);
   })){results.push({sourceId,number,status:"blocked",message:"Supplier invoice line quantity, unit price or GST differs from PO. Reconcile line-level variance manually."});continue;}
   const document=await prisma.document.findFirst({where:{id:ev.documentId,documentId:{in:[check.id,check.number]},documentType:{in:["PO","PURCHASE_ORDER"]},status:{not:"ARCHIVED"},fileUrl:{not:null}},select:{id:true,fileUrl:true}});
   if(!document?.fileUrl?.trim()){results.push({sourceId,number,status:"blocked",message:"Supplier invoice evidence file must be retained on the Purchase Order"});continue;}
   // Create the draft directly in the same Prisma store used by matching and GRNs.
   // The legacy purchase-conversions service expects different PO lifecycle statuses.
   const po=await prisma.purchaseOrder.findUnique({where:{id:check.id},include:{lines:true}});
   if(!po||!["SENT","PARTIAL_RECEIVED","RECEIVED","BILLED"].includes(String(po.status)))throw Error("Purchase Order is no longer eligible");
   if(po.lines.some(line=>!line.itemId||!Number.isFinite(Number(line.quantity))))throw Error("Unresolved PO item");
   const billNumber=await nextDocumentSeriesId("PB",Number(new Intl.DateTimeFormat("en",{timeZone:"Pacific/Port_Moresby",year:"numeric"}).format(new Date())));
   const created=await prisma.$transaction(async tx=>{
    const receiptCount=await tx.purchaseReceipt.count({where:{purchaseOrderId:po.id,status:"POSTED",journalId:{not:null}}});
    if(receiptCount===0)throw Error("Posted GRN and GRNI journal required before bill creation");
    const linked=await tx.supplierBill.findFirst({where:{OR:[{orderId:po.id},{sourceDocId:po.id},{sourceDocId:po.code},{poReference:po.code}]}});
    if(linked)throw Error("PO already linked to a Supplier Bill; reconcile before retry");
    const sameReference=await tx.supplierBill.findFirst({where:{supplierId:po.supplierId,notes:{contains:"Supplier invoice reference: "+ev.invoiceNumber+";"}}});
    if(sameReference)throw Error("Supplier invoice reference already used for this supplier");
    return tx.supplierBill.create({data:{
     code:billNumber,supplierId:po.supplierId,projectId:po.projectId,billDate:new Date(),
     status:"DRAFT",currency:po.currency,subtotal:po.subtotal,taxTotal:po.taxTotal,
     freight:po.freight,discountTotal:po.discountTotal,total:po.total,outstanding:po.total,
     orderId:po.id,sourceDocId:po.id,poReference:po.code,
     notes:"Supplier invoice reference: "+ev.invoiceNumber+"; evidence document: "+ev.documentId+"; total: "+ev.total+"; GST: "+ev.gst,
     createdBy:"bulk-three-way-match",
     lines:{create:po.lines.map(line=>({lineNo:line.lineNo,itemId:line.itemId,description:line.description,
       quantity:line.quantity,unitPrice:line.unitPrice,unit:line.unit,taxRate:line.taxRate,taxAmount:line.taxAmount,
       discountPercent:line.discountPercent,discountAmount:line.discountAmount,amount:line.amount,sortOrder:line.sortOrder}))}
    }});
   });
   results.push({sourceId,number,status:"created",createdId:created.id,documentNumber:created.code,message:"Draft Supplier Bill created in Prisma; approval and accounting posting remain separate"});
  }catch(e){results.push({sourceId,number,status:"failed",message:e instanceof Error?e.message:"Uncertain conversion outcome; reconcile first"});}
 }
 const auditFailures:string[]=[];
 for(const row of results)try{await appendAuditEvent({action:"BULK_THREE_WAY_MATCH",entityType:"SupplierBillDraftBatch",entityId:row.sourceId,entityCode:row.documentNumber||row.number,description:row.message,metadata:{batchId,result:row.status,destinationId:row.createdId||null},outcome:row.status==="created"?"SUCCESS":row.status==="blocked"?"DENIED":"FAILURE"});}catch(e){auditFailures.push(row.sourceId);console.error("supplier-bill-bulk.audit-error",{batchId,error:e});}
 return NextResponse.json({ok:true,batchId,results,auditWarning:auditFailures.length?"Some audit events failed. Preserve the result CSV.":null});
 }catch(e){const m=e instanceof Error?e.message:"Supplier bill batch failed";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:400});}
}
