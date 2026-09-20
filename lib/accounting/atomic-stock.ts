import { MovementType } from "@prisma/client";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { inventoryState, round2, round4 } from "@/lib/accounting/inventory";
import {
  inventoryAdjustmentPosting,
  inventoryIssuePosting,
  purchaseReceiptPosting,
  type PostingLine,
} from "@/lib/accounting/posting-rules";

const incoming = new Set(["PURCHASE_IN","PURCHASE_RECEIPT","SALES_ISSUE_ROLLBACK","ADJUSTMENT_IN","RETURN_IN","TRANSFER_IN"]);
const outgoing = new Set(["SALES_DELIVERY","SALES_ISSUE","SALE_OUT","PROJECT_ISSUE","ADJUSTMENT_OUT","RETURN_OUT","TRANSFER_OUT"]);
const adjustments = new Set(["LANDED_COST","REVALUATION","NRV_WRITEDOWN"]);

function stateRows(rows: Array<{type:string;quantity:any;totalCost:any}>) {
  return rows.map((r)=>{
    const type=String(r.type||"").toUpperCase();
    const qty=Number(r.quantity||0);
    const total=Number(r.totalCost||0);
    return {
      qtyIn: incoming.has(type)?qty:0,
      qtyOut: outgoing.has(type)?qty:0,
      value: adjustments.has(type)?0:Math.abs(total),
      valueAdjustment: adjustments.has(type)?total:0,
    };
  });
}

export async function postStockMovementAtomic(input:{
  movementId:string; postingDate:string; itemRef:string; projectRef?:string;
  movementType:"PROJECT_ISSUE"|"ADJUSTMENT_IN"|"ADJUSTMENT_OUT"|"RETURN_IN"|"RETURN_OUT";
  qty:number; unitCost?:number; sourceDocumentId?:string;
  inventoryAccountId:string; defaultCostAccountId:string; stockAdjustmentAccountId:string;
  expensesIncludedInValuationAccountId:string; createdBy?:string; approvedBy?:string;
}) {
  return runAtomicAccounting(async({tx,postJournal})=>{
    const item=await tx.item.findFirst({where:{OR:[{id:input.itemRef},{code:input.itemRef}]}});
    if(!item) throw new Error("Item does not exist");
    if(item.type!=="GOOD") throw new Error("Stock movements are only allowed for STOCK items");
    const project=input.projectRef?await tx.project.findFirst({where:{OR:[{id:input.projectRef},{code:input.projectRef}]}}):null;
    if(input.projectRef&&!project) throw new Error("Project does not exist");

    const rows=await tx.stockMovement.findMany({where:{itemId:item.id},orderBy:{createdAt:"asc"},select:{type:true,quantity:true,totalCost:true}});
    const current=inventoryState(stateRows(rows),Number(item.purchasePrice||0));
    const isIncoming=["ADJUSTMENT_IN","RETURN_IN"].includes(input.movementType);
    if(!isIncoming && input.qty>current.qty+0.0001) throw new Error(`Insufficient stock. On hand ${current.qty}, requested ${input.qty}`);

    const effective=input.movementType==="ADJUSTMENT_IN"?Number(input.unitCost||0):current.rate;
    if(input.movementType==="ADJUSTMENT_IN" && !(effective>0)) throw new Error("Adjustment In requires a positive Unit Cost");
    const value=round2(input.qty*effective);

    const costAccountId=String(item.costAccount||input.defaultCostAccountId);
    let lines:PostingLine[];
    if(["PROJECT_ISSUE","RETURN_OUT"].includes(input.movementType)) {
      lines=inventoryIssuePosting({amount:value,costAccountId,projectId:project?.code||project?.id,description:input.movementType==="PROJECT_ISSUE"?"Project material issue":"Inventory return out",inventoryAccountId:input.inventoryAccountId});
    } else if(input.movementType==="RETURN_IN") {
      lines=[
        {accountId:input.inventoryAccountId,debit:value,projectId:project?.code||project?.id,description:"Inventory returned in"},
        {accountId:costAccountId,credit:value,projectId:project?.code||project?.id,description:"Reverse prior inventory cost"},
      ];
    } else {
      lines=inventoryAdjustmentPosting({amountDelta:isIncoming?value:-value,projectId:project?.code||project?.id,type:input.movementType,costAccountId,inventoryAccountId:input.inventoryAccountId,stockAdjustmentAccountId:input.stockAdjustmentAccountId,expensesIncludedInValuationAccountId:input.expensesIncludedInValuationAccountId});
    }

    const movement=await tx.stockMovement.create({data:{
      id:input.movementId,itemId:item.id,type:input.movementType as MovementType,quantity:input.qty,unitCost:round4(effective),totalCost:value,
      referenceType:input.movementType,referenceId:input.sourceDocumentId||null,projectId:project?.id||null,
      createdAt:new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`),createdBy:input.createdBy||"stock-ui"
    }});

    const journal=await postJournal({postingDate:input.postingDate,documentType:`STOCK_${input.movementType}`,documentId:input.movementId,documentNumber:input.movementId,reference:input.sourceDocumentId||input.movementType.replaceAll("_"," "),projectId:project?.code||project?.id,createdBy:input.createdBy||"stock-ui",approvedBy:input.approvedBy||"Finance Controller",lines});
    await tx.stockMovement.update({where:{id:movement.id},data:{journalId:journal.journalId}});
    const newQty=round4(isIncoming?current.qty+input.qty:current.qty-input.qty);
    const newValue=round2(isIncoming?current.value+value:current.value-value);
    return {movementId:movement.id,journalId:journal.journalId,valuation:{previousRate:current.rate,movementUnitCost:round4(effective),movingAverageRate:newQty>0?round4(newValue/newQty):current.rate,previousQty:current.qty,newQty}};
  });
}

export async function postStockValueAdjustmentAtomic(input:{
  movementId:string; postingDate:string; itemRef:string; projectRef?:string;
  adjustmentType:"LANDED_COST"|"REVALUATION"|"NRV_WRITEDOWN"; amount:number; targetUnitCost:number; sourceDocumentId?:string;
  inventoryAccountId:string; defaultCostAccountId:string; stockAdjustmentAccountId:string; expensesIncludedInValuationAccountId:string;
  createdBy?:string; approvedBy?:string;
}) {
  return runAtomicAccounting(async({tx,postJournal})=>{
    const item=await tx.item.findFirst({where:{OR:[{id:input.itemRef},{code:input.itemRef}]}});
    if(!item) throw new Error("Item does not exist");
    if(item.type!=="GOOD") throw new Error("Inventory value adjustments are only allowed for STOCK items");
    const rows=await tx.stockMovement.findMany({where:{itemId:item.id},orderBy:{createdAt:"asc"},select:{type:true,quantity:true,totalCost:true}});
    const current=inventoryState(stateRows(rows),Number(item.purchasePrice||0));
    if(!(current.qty>0)) throw new Error("Inventory value adjustment requires positive stock on hand");

    let delta=0;
    if(input.adjustmentType==="LANDED_COST") delta=round2(input.amount);
    else delta=round2(current.qty*(input.targetUnitCost-current.rate));
    if(input.adjustmentType==="LANDED_COST" && !(delta>0)) throw new Error("Landed Cost amount must be greater than zero");
    if(input.adjustmentType==="NRV_WRITEDOWN" && delta>=0) throw new Error("NRV write-down must reduce inventory value");
    if(input.adjustmentType==="REVALUATION" && Math.abs(delta)<0.005) throw new Error("Revaluation does not change inventory value");
    if(round2(current.value+delta)<-0.005) throw new Error("Inventory adjustment would create a negative inventory value");

    const costAccountId=String(item.costAccount||input.defaultCostAccountId);
    const lines=inventoryAdjustmentPosting({amountDelta:delta,projectId:input.projectRef,type:input.adjustmentType,costAccountId,inventoryAccountId:input.inventoryAccountId,stockAdjustmentAccountId:input.stockAdjustmentAccountId,expensesIncludedInValuationAccountId:input.expensesIncludedInValuationAccountId});
    const nextRate=round4(Math.max(0,(current.value+delta)/current.qty));
    const movement=await tx.stockMovement.create({data:{
      id:input.movementId,itemId:item.id,type:input.adjustmentType as MovementType,quantity:0,unitCost:nextRate,totalCost:delta,
      referenceType:input.adjustmentType,referenceId:input.sourceDocumentId||null,projectId:input.projectRef||null,
      createdAt:new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`),createdBy:input.createdBy||"stock-value-adjustment"
    }});
    const journal=await postJournal({postingDate:input.postingDate,documentType:`INVENTORY_${input.adjustmentType}`,documentId:input.movementId,documentNumber:input.movementId,reference:input.sourceDocumentId||input.adjustmentType.replaceAll("_"," "),projectId:input.projectRef,createdBy:input.createdBy||"stock-value-adjustment",approvedBy:input.approvedBy||"Finance Controller",lines});
    await tx.stockMovement.update({where:{id:movement.id},data:{journalId:journal.journalId}});
    return {movementId:movement.id,journalId:journal.journalId,valuation:{previousRate:current.rate,previousValue:current.value,valueAdjustment:delta,movingAverageRate:nextRate,newValue:round2(current.value+delta)}};
  });
}

export async function postPurchaseReceiptAtomic(input:{
  receiptNumber:string; postingDate:string; purchaseOrderRef:string; projectRef?:string;
  lines:Array<{itemRef:string;qty:number}>; inventoryAccountId:string; grniAccountId:string;
  createdBy?:string; approvedBy?:string;
}) {
  return runAtomicAccounting(async({tx,postJournal})=>{
    const po=await tx.purchaseOrder.findFirst({where:{OR:[{id:input.purchaseOrderRef},{code:input.purchaseOrderRef}]},include:{supplier:true,project:true,lines:true}});
    if(!po) throw new Error("Purchase Receipt source must be a valid Purchase Order");
    if(!["SENT","PARTIAL_RECEIVED","RECEIVED","BILLED"].includes(po.status)) throw new Error("Purchase Receipt can only be created from an approved Purchase Order");
    const project=input.projectRef?await tx.project.findFirst({where:{OR:[{id:input.projectRef},{code:input.projectRef}]}}):po.project;
    if(input.projectRef&&project?.id!==po.projectId) throw new Error("Purchase Receipt project does not match the Purchase Order");

    const createdIds:string[]=[]; const valuations:any[]=[]; let inventoryValue=0;
    for(let i=0;i<input.lines.length;i++){
      const req=input.lines[i];
      const item=await tx.item.findFirst({where:{OR:[{id:req.itemRef},{code:req.itemRef}]}});
      if(!item||item.type!=="GOOD") throw new Error("Purchase Receipt can only receive STOCK items");
      const poLines=po.lines.filter(x=>x.itemId===item.id);
      if(!poLines.length) throw new Error(`Purchase Order item is not linked to Item Master: ${item.code}`);
      const ordered=poLines.reduce((s,x)=>s+Number(x.quantity),0);
      const prior=await tx.stockMovement.findMany({where:{itemId:item.id,type:"PURCHASE_RECEIPT",referenceId:{in:[po.id,po.code]}},select:{quantity:true}});
      const already=prior.reduce((s,x)=>s+Number(x.quantity),0);
      if(req.qty>ordered-already+0.0001) throw new Error(`Receipt quantity exceeds remaining PO quantity for ${item.code}`);
      const hist=await tx.stockMovement.findMany({where:{itemId:item.id},orderBy:{createdAt:"asc"},select:{type:true,quantity:true,totalCost:true}});
      const current=inventoryState(stateRows(hist),Number(item.purchasePrice||0));
      const poQty=poLines.reduce((s,x)=>s+Number(x.quantity),0);
      const poRate=poQty>0?poLines.reduce((s,x)=>s+Number(x.quantity)*Number(x.unitPrice),0)/poQty:0;
      const value=round2(req.qty*poRate); inventoryValue=round2(inventoryValue+value);
      const id=`${input.receiptNumber}-${String(i+1).padStart(3,"0")}`;
      await tx.stockMovement.create({data:{id,itemId:item.id,type:"PURCHASE_RECEIPT",quantity:req.qty,unitCost:poRate,totalCost:value,referenceType:"PURCHASE_RECEIPT",referenceId:po.id,projectId:project?.id||null,createdAt:new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`),createdBy:input.createdBy||"purchase-receipt-ui"}});
      createdIds.push(id);
      const nq=round4(current.qty+req.qty), nv=round2(current.value+value);
      valuations.push({itemId:item.id,itemCode:item.code,orderedQty:ordered,alreadyReceived:already,receivedNow:req.qty,remainingAfter:Math.max(0,ordered-already-req.qty),poRate,previousQty:current.qty,previousRate:current.rate,newQty:nq,movingAverageRate:nq>0?round4(nv/nq):poRate});
    }

    const allLines=po.lines.filter(x=>x.itemId);
    let fully=true;
    for(const pl of allLines){
      const rec=await tx.stockMovement.aggregate({where:{itemId:pl.itemId!,type:"PURCHASE_RECEIPT",referenceId:{in:[po.id,po.code]}},_sum:{quantity:true}});
      const ordered=po.lines.filter(x=>x.itemId===pl.itemId).reduce((s,x)=>s+Number(x.quantity),0);
      if(Number(rec._sum.quantity||0)+0.0001<ordered){fully=false;break;}
    }
    if(po.status!=="BILLED") await tx.purchaseOrder.update({where:{id:po.id},data:{status:fully?"RECEIVED":"PARTIAL_RECEIVED"}});

    const lines=purchaseReceiptPosting({inventoryValue,supplierId:po.supplier.code||po.supplierId,projectId:project?.code||project?.id,inventoryAccountId:input.inventoryAccountId,stockReceivedButNotBilledAccountId:input.grniAccountId});
    const journal=await postJournal({postingDate:input.postingDate,documentType:"PURCHASE_RECEIPT",documentId:input.receiptNumber,documentNumber:input.receiptNumber,reference:`Purchase Receipt against ${po.code}`,projectId:project?.code||project?.id,createdBy:input.createdBy||"purchase-receipt-ui",approvedBy:input.approvedBy||"Finance Controller",lines});
    await tx.stockMovement.updateMany({where:{id:{in:createdIds}},data:{journalId:journal.journalId}});
    return {receiptNumber:input.receiptNumber,purchaseOrderId:po.id,purchaseOrderNumber:po.code,journalId:journal.journalId,valuations,inventoryValue};
  });
}
