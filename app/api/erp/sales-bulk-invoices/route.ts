import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { POST as convertOrder } from "@/app/api/erp/sales-invoice-conversion/route";

export const dynamic = "force-dynamic";
const schema = z.object({
  action: z.literal("createDraftInvoices"),
  salesOrderIds: z.array(z.string().trim().min(1)).min(1).max(25).refine(ids=>new Set(ids).size===ids.length,"Duplicate Sales Orders in batch"),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirm: z.literal(true),
});
type Row=Record<string,unknown>;
const str=(v:unknown)=>String(v??"");
const active=(status:unknown)=>!["CANCELLED","REVERSED"].includes(str(status).toUpperCase());
async function sources(){
 const [orders,invoices,movements]=await Promise.all([
  listTable<Row>("Quotes",500,0),listTable<Row>("Invoices",500,0),listTable<Row>("StockMovements",500,0),
 ]);
 const invoiceByOrder=new Map<string,Row[]>();
 for(const invoice of invoices.rows||[]){
  if(!active(invoice.status)||str(invoice.invoiceNumber).toUpperCase().startsWith("CN-"))continue;
  const source=str(invoice.sourceDocumentId||invoice.sourceSalesOrderId||invoice.salesOrderId);
  invoiceByOrder.set(source,[...(invoiceByOrder.get(source)||[]),invoice]);
 }
 const delivered=new Set((movements.rows||[]).filter(m=>str(m.movementType).toUpperCase()==="SALES_DELIVERY"&&Number(m.qtyOut||0)>0).map(m=>str(m.sourceDocumentId)));
 return (orders.rows||[]).filter(o=>str(o.quoteNumber).toUpperCase().startsWith("SO-")).map(o=>{
  const id=str(o.quoteId),status=str(o.status).toUpperCase();
  const prior=invoiceByOrder.get(id)||[];
  const pending=prior.some(inv=>str(inv.status).toUpperCase()==="DRAFT");
  const eligible=["APPROVED","PART_DELIVERED","DELIVERED","PART_INVOICED"].includes(status)&&!pending&&delivered.has(id);
  return {salesOrderId:id,orderNumber:str(o.quoteNumber),customer:str(o.customerId),status,amount:Number(o.totalAmount||0),eligible,
   reason:pending?"Existing draft invoice requires review":!delivered.has(id)?"No posted delivery stock movement":eligible?"Ready for available-quantity invoice":"Order status not eligible"};
 });
}
export async function GET(){
 try{await requirePermission("sales.read");return NextResponse.json({ok:true,orders:await sources(),limit:25,notice:"Preflight checks posted deliveries. The conversion service determines invoicable quantity and prevents over-invoicing."});}
 catch(e){const msg=e instanceof Error?e.message:"Unable to load invoice preflight";return NextResponse.json({ok:false,error:msg},{status:msg==="Forbidden"?403:msg==="Unauthorized"?401:500});}
}
export async function POST(request:Request){
 try{
  await requirePermission("sales.write");
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(x=>x.message).join("; ")},{status:400});
  const input=parsed.data;const date=new Date(input.invoiceDate+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.invoiceDate)return NextResponse.json({ok:false,error:"Invalid invoice date"},{status:400});
  const batchId=randomUUID();
  const results:Array<{sourceId:string;status:"created"|"existing"|"blocked"|"failed";createdId?:string;documentNumber?:string;message:string}>=[];
  for(const sourceId of input.salesOrderIds){
   try{
    const row=(await sources()).find(o=>o.salesOrderId===sourceId);
    if(!row||!row.eligible){results.push({sourceId,status:"blocked",message:row?.reason||"Order unavailable in current preflight"});continue;}
    // Reuse the established single-order invoice calculation, GST allocation and quantity checks.
    const response=await convertOrder(new Request("http://localhost/api/erp/sales-invoice-conversion",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quoteId:sourceId,mode:"AVAILABLE",invoiceDate:input.invoiceDate})}));
    const data=await response.json();
    if(!response.ok||!data.ok){results.push({sourceId,status:"failed",message:String(data.error||"Invoice creation outcome uncertain; reconcile source before retry")});continue;}
    results.push({sourceId,status:data.status==="existing-draft"?"existing":"created",createdId:str(data.createdId),documentNumber:str(data.documentNumber),message:str(data.status||"Draft invoice created")});
   }catch(e){results.push({sourceId,status:"failed",message:e instanceof Error?e.message:"Outcome uncertain; reconcile before retry"});}
  }
  console.info("sales.bulk-invoices.completed",{batchId,results});
  return NextResponse.json({ok:true,batchId,results});
 }catch(e){const msg=e instanceof Error?e.message:"Bulk invoice generation failed";return NextResponse.json({ok:false,error:msg},{status:msg==="Forbidden"?403:msg==="Unauthorized"?401:400});}
}
