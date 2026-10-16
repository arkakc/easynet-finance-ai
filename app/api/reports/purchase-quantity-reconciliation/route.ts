import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET() {
 try {
  await requirePermission("reports.read");
  const orders = await prisma.purchaseOrder.findMany({
   where:{code:{startsWith:"PO-"}},
   orderBy:{createdAt:"desc"},take:100,
   select:{id:true,code:true,status:true,supplier:{select:{name:true}},lines:{select:{itemId:true,quantity:true,item:{select:{code:true,type:true}}}}},
  });
  const ids=orders.map(o=>o.id),codes=orders.map(o=>o.code);
  const [movements,bills]=await Promise.all([
   prisma.stockMovement.findMany({where:{type:"PURCHASE_RECEIPT",referenceId:{in:[...ids,...codes]}},select:{referenceId:true,itemId:true,quantity:true}}),
   prisma.supplierBill.findMany({where:{OR:[{orderId:{in:ids}},{sourceDocId:{in:ids}},{sourceDocId:{in:codes}},{poReference:{in:codes}}]},select:{id:true,code:true,status:true,orderId:true,sourceDocId:true,poReference:true,lines:{select:{itemId:true,quantity:true}}}}),
  ]);
  const result=orders.map(po=>{
   const linkedBills=bills.filter(b=>b.orderId===po.id||b.sourceDocId===po.id||b.sourceDocId===po.code||b.poReference===po.code);
   const goods=po.lines.filter(l=>l.item?.type==="GOOD"&&l.itemId);
   const orderedByItem=new Map<string,number>();
   for(const l of goods){const key=String(l.itemId);orderedByItem.set(key,(orderedByItem.get(key)||0)+Number(l.quantity));}
   const lines=[...orderedByItem.entries()].map(([itemId,ordered])=>{
    const received=movements.filter(m=>m.itemId===itemId&&(m.referenceId===po.id||m.referenceId===po.code)).reduce((v,m)=>v+Number(m.quantity),0);
    const billed=linkedBills.filter(b=>b.status!=="CANCELLED"&&b.status!=="VOID").flatMap(b=>b.lines).filter(l=>l.itemId===itemId).reduce((v,l)=>v+Number(l.quantity),0);
    return {itemId,itemCode:goods.find(l=>l.itemId===itemId)?.item?.code||itemId,ordered,received,billed,
      receivedNotBilled:received-billed,
      exception:received>ordered+0.0001?"OVER_RECEIVED":billed>received+0.0001?"BILLED_ABOVE_RECEIVED":billed<0?"NEGATIVE_BILLING":null};
   });
   const issues=lines.filter(l=>l.exception).map(l=>l.itemCode+": "+l.exception);
   if(linkedBills.length>1)issues.push("Multiple bills linked to a PO");
   if(!goods.length)issues.push("No stock lines (manual service review)");
   return {id:po.id,number:po.code,supplier:po.supplier?.name||"",status:String(po.status),billNumbers:linkedBills.map(b=>b.code),lines,issues};
  });
  return NextResponse.json({ok:true,orders:result,scope:"Read-only quantity reconciliation; not a monetary GRNI close or AP audit",checkedAt:new Date().toISOString(),maxOrders:100});
 }catch(error){const message=error instanceof Error?error.message:"Purchase reconciliation unavailable";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:500});}
}
