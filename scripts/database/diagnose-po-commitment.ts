import { prisma } from "../../src/lib/prisma";
import { outstandingPurchaseCommitments } from "../../lib/accounting/purchase-commitments";
const n=(v:unknown)=>Number(v||0);
async function main(){
 const orders=await prisma.purchaseOrder.findMany({include:{lines:{include:{item:{select:{code:true,type:true}}}}}});
 const receipts=await prisma.stockMovement.findMany({where:{type:"PURCHASE_RECEIPT"},select:{referenceId:true,itemId:true,quantity:true}});
 const bills=await prisma.supplierBill.findMany({where:{glPosted:true},include:{lines:{select:{itemId:true,quantity:true}}}});
 for(const po of orders){
  const linkedR=receipts.filter(r=>r.referenceId===po.id||r.referenceId===po.code);
  const linkedB=bills.filter(b=>b.orderId===po.id||b.poReference===po.id||b.poReference===po.code);
  const commitment=outstandingPurchaseCommitments([po],linkedR,linkedB);
  console.log(`PO ${po.code}: status=${po.status}, commitment=K${commitment.toFixed(2)}, lines=${po.lines.length}, receipt movements=${linkedR.length}, posted bills=${linkedB.length}`);
  for(const line of po.lines){
    const id=line.itemId;
    const received=linkedR.filter(r=>r.itemId===id).reduce((s,r)=>s+n(r.quantity),0);
    const billed=linkedB.flatMap(b=>b.lines).filter(r=>r.itemId===id).reduce((s,r)=>s+n(r.quantity),0);
    console.log(`  Item ${line.item?.code||"UNLINKED"} type=${line.item?.type||"UNKNOWN"} linked=${Boolean(id)} ordered=${n(line.quantity)} received=${received} billed=${billed}`);
    if(!id)console.log("  INVESTIGATE: PO line missing Item Master link, cannot match stock receipt by itemId.");
    else if(received===0&&billed===0&&linkedR.length+linkedB.length>0)console.log("  INVESTIGATE: PO line did not match received/billed item IDs.");
  }
 }
 console.log("READ-ONLY: No PO, stock, bill, bank or GL records modified.");
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
