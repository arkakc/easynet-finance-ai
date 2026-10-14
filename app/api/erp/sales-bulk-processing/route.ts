import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { POST as convertQuotation } from "@/app/api/erp/sales-order-conversion/route";

export const dynamic = "force-dynamic";
const approved = new Set(["APPROVED", "SENT", "ACCEPTED"]);
const schema = z.object({
  action: z.literal("convertQuotesToOrders"),
  quoteIds: z.array(z.string().trim().min(1)).min(1).max(25),
  orderDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
  confirm: z.literal(true),
});
type Quote = {quoteId?:string;quoteNumber?:string;customerId?:string;status?:string;totalAmount?:number;sourceDocumentId?:string};
function eligible(row:Quote, linked:Set<string>){
  const id=String(row.quoteId||"");
  const status=String(row.status||"").toUpperCase();
  if (!id || String(row.quoteNumber||"").toUpperCase().startsWith("SO-")) return {eligible:false,reason:"Not a source quotation"};
  if (linked.has(id)||status==="CONVERTED") return {eligible:false,reason:"Sales Order already linked or source converted"};
  if (!approved.has(status)) return {eligible:false,reason:"Quotation is not approved/accepted"};
  return {eligible:true,reason:"Eligible for controlled conversion"};
}
async function inventory(){
  const data=await listTable<Quote>("Quotes",500,0);
  const rows=data.rows||[];
  const linked=new Set(rows.filter(x=>String(x.quoteNumber||"").toUpperCase().startsWith("SO-") && !["CANCELLED","REVERSED"].includes(String(x.status||"").toUpperCase())).map(x=>String(x.sourceDocumentId||"")).filter(Boolean));
  return {rows,linked};
}
export async function GET(){
  try{
    await requirePermission("sales.read");
    const {rows,linked}=await inventory();
    const quotes=rows.filter(q=>!String(q.quoteNumber||"").toUpperCase().startsWith("SO-")).map(q=>({
      quoteId:String(q.quoteId||""),quoteNumber:String(q.quoteNumber||""),customerId:String(q.customerId||""),
      status:String(q.status||""),totalAmount:Number(q.totalAmount||0),...eligible(q,linked),
    }));
    return NextResponse.json({ok:true,quotes,limit:25,notice:"Register currently reads up to 500 source records. Refresh and revalidate immediately before processing."});
  }catch(e){const message=e instanceof Error?e.message:"Unable to load bulk processing";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:500});}
}
export async function POST(request:Request){
  try{
    await requirePermission("sales.write");
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(x=>x.message).join("; ")},{status:400});
    const input=parsed.data;
    if(new Set(input.quoteIds).size!==input.quoteIds.length)return NextResponse.json({ok:false,error:"Duplicate quotation IDs in batch"},{status:400});
    const date=new Date(input.orderDate+"T00:00:00Z");
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.orderDate)return NextResponse.json({ok:false,error:"Invalid order date"},{status:400});
    const batchId=randomUUID();
    const results:Array<{quoteId:string;status:"created"|"existing"|"blocked"|"failed";documentNumber?:string;createdId?:string;message:string}>=[];
    for(const quoteId of input.quoteIds){
      try{
        const {rows,linked}=await inventory();
        const source=rows.find(q=>String(q.quoteId||"")===quoteId);
        if(!source){results.push({quoteId,status:"blocked",message:"Quotation was not found in current register. Do not retry until source is verified."});continue;}
        const check=eligible(source,linked);
        if(!check.eligible){results.push({quoteId,status:"blocked",message:check.reason});continue;}
        // Invoke the existing guarded conversion route. Never duplicate its accounting/conversion logic.
        const downstream=await convertQuotation(new Request("http://localhost/api/erp/sales-order-conversion",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quoteId,orderDate:input.orderDate})}));
        const detail=await downstream.json();
        if(!downstream.ok||!detail.ok){results.push({quoteId,status:"failed",message:String(detail.error||"Conversion failed; reconcile before retrying")});continue;}
        results.push({quoteId,status:String(detail.status||"").startsWith("existing")?"existing":"created",createdId:String(detail.createdId||""),documentNumber:String(detail.documentNumber||""),message:String(detail.status||"Converted")});
      }catch(e){results.push({quoteId,status:"failed",message:e instanceof Error?e.message:"Outcome uncertain; reconcile before retrying"});}
    }
    console.info("sales.bulk-conversion.completed",{batchId,action:input.action,requested:results.length,created:results.filter(x=>x.status==="created").length,blocked:results.filter(x=>x.status==="blocked").length,failed:results.filter(x=>x.status==="failed").length,results});
    return NextResponse.json({ok:true,batchId,results});
  }catch(e){const message=e instanceof Error?e.message:"Bulk conversion failed";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:400});}
}
