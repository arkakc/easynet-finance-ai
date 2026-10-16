import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { POST as convert } from "@/app/api/erp/purchase-conversions/route";
import { appendAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
type Purchase = { poId?:string; poNumber?:string; supplierId?:string; status?:string; totalAmount?:number; sourceDocumentId?:string };
const schema=z.object({action:z.literal("convertSupplierQuotes"),supplierQuoteIds:z.array(z.string().trim().min(1)).min(1).max(25).refine(x=>new Set(x).size===x.length,"Duplicate quotation IDs"),confirm:z.literal(true)});
function eligible(row:Purchase|undefined,linked:Set<string>){
 if(!row||!String(row.poNumber||"").toUpperCase().startsWith("SUPQ-"))return {eligible:false,reason:"Supplier quotation missing"};
 if(linked.has(String(row.poId||""))||String(row.status||"").toUpperCase()==="CONVERTED")return {eligible:false,reason:"Already converted"};
 if(!["APPROVED","SENT"].includes(String(row.status||"").toUpperCase()))return {eligible:false,reason:"Supplier quotation must be approved"};
 return {eligible:true,reason:"Ready for conversion; item lines rechecked during processing"};
}
async function preview(){
 const data=await listTable<Purchase>("PurchaseOrders",500,0);
 const rows=data.rows||[];
 const linked=new Set(rows.filter(r=>!String(r.poNumber||"").toUpperCase().startsWith("SUPQ-")&&!["CANCELLED","REVERSED"].includes(String(r.status||"").toUpperCase())).map(r=>String(r.sourceDocumentId||"")).filter(Boolean));
 return {rows,linked};
}
export async function GET(){
 try{
  await requirePermission("purchase.read");
  const {rows,linked}=await preview();
  return NextResponse.json({ok:true,limit:25,quotes:rows.filter(r=>String(r.poNumber||"").toUpperCase().startsWith("SUPQ-")).map(r=>({
   id:String(r.poId||""),number:String(r.poNumber||""),supplier:String(r.supplierId||""),status:String(r.status||""),amount:Number(r.totalAmount||0),...eligible(r,linked),
  }))});
 }catch(e){const m=e instanceof Error?e.message:"Purchase preflight failed";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:500});}
}
export async function POST(request:Request){
 try{
  await requirePermission("purchase.write");
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(i=>i.message).join("; ")},{status:400});
  const batchId=randomUUID();
  const results:Array<{sourceId:string;status:"created"|"blocked"|"failed";number?:string;createdId?:string;message:string}>=[];
  for(const sourceId of parsed.data.supplierQuoteIds){
   try{
    // Do not rely solely on the capped register: look up each source and linked destination again.
    const [source,existing]=await Promise.all([
     findRecords<Purchase>("PurchaseOrders",{poId:sourceId},1),
     findRecords<Purchase>("PurchaseOrders",{sourceDocumentId:sourceId},20),
    ]);
    const linked=new Set(existing.rows.filter(r=>!String(r.poNumber||"").toUpperCase().startsWith("SUPQ-")&&!["CANCELLED","REVERSED"].includes(String(r.status||"").toUpperCase())).map(()=>sourceId));
    const preflight=eligible(source.rows[0],linked);
    if(!preflight.eligible){results.push({sourceId,status:"blocked",message:preflight.reason});continue;}
    const response=await convert(new Request("http://localhost/api/erp/purchase-conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({supplierQuoteId:sourceId})}));
    const body=await response.json();
    if(!response.ok||!body.ok){results.push({sourceId,status:"failed",message:String(body.error||"Conversion outcome uncertain; reconcile before retry")});continue;}
    results.push({sourceId,status:"created",createdId:String(body.createdId||""),number:String(body.documentNumber||""),message:String(body.status||"Draft Purchase Order created")});
   }catch(e){results.push({sourceId,status:"failed",message:e instanceof Error?e.message:"Outcome uncertain; reconcile before retry"});}
  }
  const auditFailures:string[]=[];
  for(const result of results){
   try{await appendAuditEvent({action:"BULK_CONVERT",entityType:"SupplierQuoteToPurchaseOrder",entityId:result.sourceId,entityCode:result.number||null,
    description:result.message,metadata:{batchId,destinationId:result.createdId||null,status:result.status},outcome:result.status==="created"?"SUCCESS":result.status==="blocked"?"DENIED":"FAILURE"});}
   catch(e){auditFailures.push(result.sourceId);console.error("purchase.bulk-conversion.audit-failed",{batchId,sourceId:result.sourceId,error:e});}
  }
  return NextResponse.json({ok:true,batchId,results,auditWarning:auditFailures.length?"Some audit records failed. Preserve batch results for reconciliation.":null});
 }catch(e){const m=e instanceof Error?e.message:"Bulk conversion failed";return NextResponse.json({ok:false,error:m},{status:m==="Forbidden"?403:m==="Unauthorized"?401:400});}
}
