import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { POST as createDelivery } from "@/app/api/erp/sales-delivery-note/route";

export const dynamic = "force-dynamic";
const requestSchema = z.object({
 action: z.literal("createDraftDeliveryNotes"),
 salesOrderIds: z.array(z.string().trim().min(1)).min(1).max(25).refine(ids => new Set(ids).size === ids.length,"Duplicate Sales Orders are not allowed"),
 deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 confirm: z.literal(true),
});

async function readOrders(){
 const [orders,notes]=await Promise.all([
  prisma.quote.findMany({where:{code:{startsWith:"SO-"}},orderBy:{createdAt:"desc"},take:500,select:{id:true,code:true,status:true,total:true,customer:{select:{code:true,name:true}}}}),
  prisma.deliveryNote.findMany({where:{status:{in:["DRAFT","POSTED"]}},select:{salesOrderId:true}}),
 ]);
 const linked=new Set(notes.map(note=>note.salesOrderId));
 return orders.map(order=>{
  const status=String(order.status||"").toUpperCase();
  const eligible=["ACCEPTED","PART_DELIVERED"].includes(status)&&!linked.has(order.id);
  return {salesOrderId:order.id,orderNumber:order.code,customer:order.customer?.name||order.customer?.code||"",status,totalAmount:Number(order.total||0),eligible,reason:linked.has(order.id)?"A draft or posted delivery already exists":eligible?"Ready": "Sales Order must be accepted / partly delivered"};
 });
}

export async function GET(){
 try {await requirePermission("sales.read");return NextResponse.json({ok:true,orders:await readOrders(),limit:25});}
 catch(error){const message=error instanceof Error?error.message:"Bulk delivery preview failed";return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});}
}

export async function POST(request:Request){
 try{
  await requirePermission("sales.write");
  const parsed=requestSchema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({ok:false,error:parsed.error.issues.map(issue=>issue.message).join("; ")},{status:400});
  const input=parsed.data;
  const date=new Date(input.deliveryDate+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.deliveryDate)return NextResponse.json({ok:false,error:"Invalid delivery date"},{status:400});
  const batchId=randomUUID();
  const results:Array<{sourceId:string;status:"created"|"existing"|"blocked"|"failed";documentNumber?:string;createdId?:string;message:string}>=[];
  for(const sourceId of input.salesOrderIds){
   try{
    const current=(await readOrders()).find(order=>order.salesOrderId===sourceId);
    if(!current){results.push({sourceId,status:"blocked",message:"Sales Order not found in current register"});continue;}
    if(!current.eligible){results.push({sourceId,status:"blocked",message:current.reason});continue;}
    const response=await createDelivery(new Request("http://localhost/api/erp/sales-delivery-note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createDraft",salesOrderId:sourceId,deliveryDate:input.deliveryDate})}));
    const payload=await response.json();
    if(!response.ok||!payload.ok){results.push({sourceId,status:"failed",message:String(payload.error||"Delivery creation failed; reconcile before retrying")});continue;}
    results.push({sourceId,status:payload.existing?"existing":"created",createdId:String(payload.deliveryNote?.deliveryId||""),documentNumber:String(payload.deliveryNote?.deliveryNumber||""),message:String(payload.message||"Draft created")});
   }catch(error){results.push({sourceId,status:"failed",message:error instanceof Error?error.message:"Outcome uncertain; reconcile before retrying"});}
  }
  console.info("sales.bulk-deliveries.completed",{batchId,results});
  return NextResponse.json({ok:true,batchId,results});
 }catch(error){const message=error instanceof Error?error.message:"Bulk delivery creation failed";return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});}
}
