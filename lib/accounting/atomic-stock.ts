import { MovementType } from "@prisma/client";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { round2, round4 } from "@/lib/accounting/inventory";
import {
  inventoryAdjustmentPosting,
  inventoryIssuePosting,
  purchaseReceiptPosting,
  type PostingLine,
} from "@/lib/accounting/posting-rules";
import {
  resolveWarehouse,
  syncWarehouseBalance,
  warehouseInventoryState,
} from "@/lib/accounting/warehouse-stock";

export async function postStockMovementAtomic(input:{
  movementId:string; postingDate:string; itemRef:string; projectRef?:string; warehouseRef?:string;
  movementType:"PROJECT_ISSUE"|"ADJUSTMENT_IN"|"ADJUSTMENT_OUT"|"RETURN_IN"|"RETURN_OUT";
  qty:number; unitCost?:number; sourceDocumentId?:string;
  inventoryAccountId:string; defaultCostAccountId:string; stockAdjustmentAccountId:string;
  expensesIncludedInValuationAccountId:string; createdBy?:string; approvedBy?:string;
}) {
  return runAtomicAccounting(async({tx,postJournal})=>{
    const item=await tx.item.findFirst({where:{OR:[{id:input.itemRef},{code:input.itemRef}]}});
    if(!item) throw new Error("Item does not exist");
    if(item.type!=="GOOD") throw new Error("Stock movements are only allowed for STOCK items");
    const warehouse=await resolveWarehouse(tx,input.warehouseRef);
    const project=input.projectRef?await tx.project.findFirst({where:{OR:[{id:input.projectRef},{code:input.projectRef}]}}):null;
    if(input.projectRef&&!project) throw new Error("Project does not exist");

    const current=await warehouseInventoryState(tx,item.id,warehouse.id,Number(item.purchasePrice||0));
    const isIncoming=["ADJUSTMENT_IN","RETURN_IN"].includes(input.movementType);
    if(!isIncoming && input.qty>current.qty+0.0001) {
      throw new Error(`Insufficient stock in ${warehouse.code}. On hand ${current.qty}, requested ${input.qty}`);
    }

    const effective=input.movementType==="ADJUSTMENT_IN"?Number(input.unitCost||0):current.rate;
    if(input.movementType==="ADJUSTMENT_IN" && !(effective>0)) throw new Error("Adjustment In requires a positive Unit Cost");
    const value=round2(input.qty*effective);

    const costAccountId=String(item.costAccount||input.defaultCostAccountId);
    let lines:PostingLine[];
    if(["PROJECT_ISSUE","RETURN_OUT"].includes(input.movementType)) {
      lines=inventoryIssuePosting({
        amount:value,costAccountId,projectId:project?.code||project?.id,
        description:input.movementType==="PROJECT_ISSUE"?"Project material issue":"Inventory return out",
        inventoryAccountId:input.inventoryAccountId,
      });
    } else if(input.movementType==="RETURN_IN") {
      lines=[
        {accountId:input.inventoryAccountId,debit:value,projectId:project?.code||project?.id,description:"Inventory returned in"},
        {accountId:costAccountId,credit:value,projectId:project?.code||project?.id,description:"Reverse prior inventory cost"},
      ];
    } else {
      lines=inventoryAdjustmentPosting({
        amountDelta:isIncoming?value:-value,projectId:project?.code||project?.id,type:input.movementType,
        costAccountId,inventoryAccountId:input.inventoryAccountId,stockAdjustmentAccountId:input.stockAdjustmentAccountId,
        expensesIncludedInValuationAccountId:input.expensesIncludedInValuationAccountId,
      });
    }

    const movement=await tx.stockMovement.create({data:{
      id:input.movementId,itemId:item.id,warehouseId:warehouse.id,type:input.movementType as MovementType,
      quantity:input.qty,unitCost:round4(effective),totalCost:value,referenceType:input.movementType,
      referenceId:input.sourceDocumentId||null,projectId:project?.id||null,
      createdAt:new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`),createdBy:input.createdBy||"stock-ui",
    }});

    const journal=await postJournal({
      postingDate:input.postingDate,documentType:`STOCK_${input.movementType}`,documentId:input.movementId,
      documentNumber:input.movementId,reference:input.sourceDocumentId||input.movementType.replaceAll("_"," "),
      projectId:project?.code||project?.id,createdBy:input.createdBy||"stock-ui",
      approvedBy:input.approvedBy||"Finance Controller",lines,
    });
    await tx.stockMovement.update({where:{id:movement.id},data:{journalId:journal.journalId}});

    const newQty=round4(isIncoming?current.qty+input.qty:current.qty-input.qty);
    const newValue=round2(isIncoming?current.value+value:current.value-value);
    const nextRate=newQty>0?round4(newValue/newQty):current.rate;
    await syncWarehouseBalance(tx,{
      itemId:item.id,warehouseId:warehouse.id,quantity:newQty,value:newValue,rate:nextRate,
    });

    return {
      movementId:movement.id,journalId:journal.journalId,
      warehouse:{id:warehouse.id,code:warehouse.code,name:warehouse.name},
      valuation:{previousRate:current.rate,movementUnitCost:round4(effective),movingAverageRate:nextRate,previousQty:current.qty,newQty},
    };
  });
}

export async function postStockValueAdjustmentAtomic(input:{
  movementId:string; postingDate:string; itemRef:string; projectRef?:string; warehouseRef?:string;
  adjustmentType:"LANDED_COST"|"REVALUATION"|"NRV_WRITEDOWN"; amount:number; targetUnitCost:number; sourceDocumentId?:string;
  inventoryAccountId:string; defaultCostAccountId:string; stockAdjustmentAccountId:string; expensesIncludedInValuationAccountId:string;
  createdBy?:string; approvedBy?:string;
}) {
  return runAtomicAccounting(async({tx,postJournal})=>{
    const item=await tx.item.findFirst({where:{OR:[{id:input.itemRef},{code:input.itemRef}]}});
    if(!item) throw new Error("Item does not exist");
    if(item.type!=="GOOD") throw new Error("Inventory value adjustments are only allowed for STOCK items");
    const warehouse=await resolveWarehouse(tx,input.warehouseRef);
    const project=input.projectRef?await tx.project.findFirst({where:{OR:[{id:input.projectRef},{code:input.projectRef}]}}):null;
    if(input.projectRef&&!project) throw new Error("Project does not exist");

    const current=await warehouseInventoryState(tx,item.id,warehouse.id,Number(item.purchasePrice||0));
    if(!(current.qty>0)) throw new Error(`Inventory value adjustment requires positive stock on hand in ${warehouse.code}`);

    let delta=0;
    if(input.adjustmentType==="LANDED_COST") delta=round2(input.amount);
    else delta=round2(current.qty*(input.targetUnitCost-current.rate));
    if(input.adjustmentType==="LANDED_COST" && !(delta>0)) throw new Error("Landed Cost amount must be greater than zero");
    if(input.adjustmentType==="NRV_WRITEDOWN" && delta>=0) throw new Error("NRV write-down must reduce inventory value");
    if(input.adjustmentType==="REVALUATION" && Math.abs(delta)<0.005) throw new Error("Revaluation does not change inventory value");
    if(round2(current.value+delta)<-0.005) throw new Error("Inventory adjustment would create a negative inventory value");

    const costAccountId=String(item.costAccount||input.defaultCostAccountId);
    const lines=inventoryAdjustmentPosting({
      amountDelta:delta,projectId:project?.code||project?.id,type:input.adjustmentType,costAccountId,
      inventoryAccountId:input.inventoryAccountId,stockAdjustmentAccountId:input.stockAdjustmentAccountId,
      expensesIncludedInValuationAccountId:input.expensesIncludedInValuationAccountId,
    });
    const nextValue=round2(current.value+delta);
    const nextRate=round4(Math.max(0,nextValue/current.qty));
    const movement=await tx.stockMovement.create({data:{
      id:input.movementId,itemId:item.id,warehouseId:warehouse.id,type:input.adjustmentType as MovementType,
      quantity:0,unitCost:nextRate,totalCost:delta,referenceType:input.adjustmentType,
      referenceId:input.sourceDocumentId||null,projectId:project?.id||null,
      createdAt:new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`),createdBy:input.createdBy||"stock-value-adjustment",
    }});
    const journal=await postJournal({
      postingDate:input.postingDate,documentType:`INVENTORY_${input.adjustmentType}`,documentId:input.movementId,
      documentNumber:input.movementId,reference:input.sourceDocumentId||input.adjustmentType.replaceAll("_"," "),
      projectId:project?.code||project?.id,createdBy:input.createdBy||"stock-value-adjustment",
      approvedBy:input.approvedBy||"Finance Controller",lines,
    });
    await tx.stockMovement.update({where:{id:movement.id},data:{journalId:journal.journalId}});
    await syncWarehouseBalance(tx,{
      itemId:item.id,warehouseId:warehouse.id,quantity:current.qty,value:nextValue,rate:nextRate,
    });
    return {
      movementId:movement.id,journalId:journal.journalId,
      warehouse:{id:warehouse.id,code:warehouse.code,name:warehouse.name},
      valuation:{previousRate:current.rate,previousValue:current.value,valueAdjustment:delta,movingAverageRate:nextRate,newValue:nextValue},
    };
  });
}

export async function postPurchaseReceiptAtomic(input:{
  receiptNumber:string; postingDate:string; purchaseOrderRef:string; projectRef?:string; warehouseRef?:string;
  lines:Array<{itemRef:string;qty:number}>; inventoryAccountId:string; grniAccountId:string;
  createdBy?:string; approvedBy?:string;
}) {
  return runAtomicAccounting(async({tx,postJournal})=>{
    const po=await tx.purchaseOrder.findFirst({
      where:{OR:[{id:input.purchaseOrderRef},{code:input.purchaseOrderRef}]},
      include:{supplier:true,project:true,lines:true},
    });
    if(!po) throw new Error("Purchase Receipt source must be a valid Purchase Order");
    if(!["SENT","PARTIAL_RECEIVED","RECEIVED","BILLED"].includes(po.status)) throw new Error("Purchase Receipt can only be created from an approved Purchase Order");
    // Purchase Order is a commitment, not the inventory-recognition event.
    // Inventory/GRNI therefore use the approved spot rate at receipt date rather
    // than freezing the non-accounting PO quotation/order rate.
    const fx=await resolveDocumentExchangeRate(tx,{
      currency:po.currency,
      postingDate:input.postingDate,
    });
    const warehouse=await resolveWarehouse(tx,input.warehouseRef);
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
      const prior=await tx.stockMovement.findMany({
        where:{itemId:item.id,type:"PURCHASE_RECEIPT",referenceId:{in:[po.id,po.code]}},select:{quantity:true},
      });
      const already=prior.reduce((s,x)=>s+Number(x.quantity),0);
      if(req.qty>ordered-already+0.0001) throw new Error(`Receipt quantity exceeds remaining PO quantity for ${item.code}`);

      const current=await warehouseInventoryState(tx,item.id,warehouse.id,Number(item.purchasePrice||0));
      const poQty=poLines.reduce((s,x)=>s+Number(x.quantity),0);
      const poRateTransaction=poQty>0?poLines.reduce((s,x)=>s+Number(x.quantity)*Number(x.unitPrice),0)/poQty:0;
      const poRateBase=toBaseAmount(poRateTransaction,fx.currency,fx.baseCurrency,fx.exchangeRate);
      const transactionValue=round2(req.qty*poRateTransaction);
      const value=toBaseAmount(transactionValue,fx.currency,fx.baseCurrency,fx.exchangeRate); inventoryValue=round2(inventoryValue+value);
      const id=`${input.receiptNumber}-${String(i+1).padStart(3,"0")}`;
      await tx.stockMovement.create({data:{
        id,itemId:item.id,warehouseId:warehouse.id,type:"PURCHASE_RECEIPT",quantity:req.qty,unitCost:poRateBase,totalCost:value,
        referenceType:"PURCHASE_RECEIPT",referenceId:po.id,projectId:project?.id||null,
        createdAt:new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`),createdBy:input.createdBy||"purchase-receipt-ui",
      }});
      createdIds.push(id);
      const nq=round4(current.qty+req.qty), nv=round2(current.value+value);
      const rate=nq>0?round4(nv/nq):poRateBase;
      await syncWarehouseBalance(tx,{itemId:item.id,warehouseId:warehouse.id,quantity:nq,value:nv,rate});
      valuations.push({
        itemId:item.id,itemCode:item.code,warehouseId:warehouse.id,warehouseCode:warehouse.code,
        orderedQty:ordered,alreadyReceived:already,receivedNow:req.qty,remainingAfter:Math.max(0,ordered-already-req.qty),
        poRate:poRateTransaction,poRateBase,currency:fx.currency,exchangeRate:fx.exchangeRate,previousQty:current.qty,previousRate:current.rate,newQty:nq,movingAverageRate:rate,
      });
    }

    const allItemIds=[...new Set(po.lines.filter(x=>x.itemId).map(x=>x.itemId!))];
    let fully=true;
    for(const itemId of allItemIds){
      const rec=await tx.stockMovement.aggregate({
        where:{itemId,type:"PURCHASE_RECEIPT",referenceId:{in:[po.id,po.code]}},_sum:{quantity:true},
      });
      const ordered=po.lines.filter(x=>x.itemId===itemId).reduce((s,x)=>s+Number(x.quantity),0);
      if(Number(rec._sum.quantity||0)+0.0001<ordered){fully=false;break;}
    }
    if(po.status!=="BILLED") await tx.purchaseOrder.update({where:{id:po.id},data:{status:fully?"RECEIVED":"PARTIAL_RECEIVED"}});

    const lines=purchaseReceiptPosting({
      inventoryValue,supplierId:po.supplier.code||po.supplierId,projectId:project?.code||project?.id,
      inventoryAccountId:input.inventoryAccountId,stockReceivedButNotBilledAccountId:input.grniAccountId,
    });
    const journal=await postJournal({
      postingDate:input.postingDate,documentType:"PURCHASE_RECEIPT",documentId:input.receiptNumber,
      documentNumber:input.receiptNumber,reference:`Purchase Receipt against ${po.code} into ${warehouse.code}`,
      projectId:project?.code||project?.id,currency:fx.currency,baseCurrency:fx.baseCurrency,exchangeRate:fx.exchangeRate,
      createdBy:input.createdBy||"purchase-receipt-ui",
      approvedBy:input.approvedBy||"Finance Controller",lines,
    });
    await tx.stockMovement.updateMany({where:{id:{in:createdIds}},data:{journalId:journal.journalId}});
    return {
      receiptNumber:input.receiptNumber,purchaseOrderId:po.id,purchaseOrderNumber:po.code,journalId:journal.journalId,
      warehouse:{id:warehouse.id,code:warehouse.code,name:warehouse.name},valuations,inventoryValue,
      currency:fx.currency,baseCurrency:fx.baseCurrency,exchangeRate:fx.exchangeRate,
    };
  });
}

export async function transferStockAtomic(input:{
  transferId:string; postingDate:string; itemRef:string; fromWarehouseRef:string; toWarehouseRef:string;
  qty:number; projectRef?:string; sourceDocumentId?:string; note?:string; createdBy?:string;
}) {
  return runAtomicAccounting(async({tx})=>{
    const item=await tx.item.findFirst({where:{OR:[{id:input.itemRef},{code:input.itemRef}]}});
    if(!item) throw new Error("Item does not exist");
    if(item.type!=="GOOD") throw new Error("Warehouse transfer is only allowed for STOCK items");
    const fromWarehouse=await resolveWarehouse(tx,input.fromWarehouseRef);
    const toWarehouse=await resolveWarehouse(tx,input.toWarehouseRef);
    if(fromWarehouse.id===toWarehouse.id) throw new Error("Source and destination warehouses must be different");
    const project=input.projectRef?await tx.project.findFirst({where:{OR:[{id:input.projectRef},{code:input.projectRef}]}}):null;
    if(input.projectRef&&!project) throw new Error("Project does not exist");
    const qty=round4(Number(input.qty||0));
    if(!(qty>0)) throw new Error("Transfer quantity must be greater than zero");

    const [source,destination]=await Promise.all([
      warehouseInventoryState(tx,item.id,fromWarehouse.id,Number(item.purchasePrice||0)),
      warehouseInventoryState(tx,item.id,toWarehouse.id,Number(item.purchasePrice||0)),
    ]);
    if(qty>source.qty+0.0001) {
      throw new Error(`Insufficient stock in ${fromWarehouse.code}. On hand ${source.qty}, requested ${qty}`);
    }
    const rate=source.rate;
    const value=round2(qty*rate);
    const createdAt=new Date(`${input.postingDate.slice(0,10)}T00:00:00+10:00`);
    const outId=`${input.transferId}-OUT`, inId=`${input.transferId}-IN`;

    await tx.stockMovement.createMany({data:[
      {
        id:outId,itemId:item.id,warehouseId:fromWarehouse.id,type:"TRANSFER_OUT",quantity:qty,unitCost:rate,totalCost:value,
        referenceType:"WAREHOUSE_TRANSFER",referenceId:input.sourceDocumentId||input.transferId,transferId:input.transferId,
        projectId:project?.id||null,note:input.note||null,createdAt,createdBy:input.createdBy||"warehouse-transfer",
      },
      {
        id:inId,itemId:item.id,warehouseId:toWarehouse.id,type:"TRANSFER_IN",quantity:qty,unitCost:rate,totalCost:value,
        referenceType:"WAREHOUSE_TRANSFER",referenceId:input.sourceDocumentId||input.transferId,transferId:input.transferId,
        projectId:project?.id||null,note:input.note||null,createdAt,createdBy:input.createdBy||"warehouse-transfer",
      },
    ]});

    const sourceQty=round4(source.qty-qty), sourceValue=round2(Math.max(0,source.value-value));
    const destinationQty=round4(destination.qty+qty), destinationValue=round2(destination.value+value);
    const destinationRate=destinationQty>0?round4(destinationValue/destinationQty):rate;
    await syncWarehouseBalance(tx,{itemId:item.id,warehouseId:fromWarehouse.id,quantity:sourceQty,value:sourceValue,rate:sourceQty>0?source.rate:0});
    await syncWarehouseBalance(tx,{itemId:item.id,warehouseId:toWarehouse.id,quantity:destinationQty,value:destinationValue,rate:destinationRate});

    return {
      transferId:input.transferId,itemId:item.id,itemCode:item.code,quantity:qty,unitCost:rate,value,
      fromWarehouse:{id:fromWarehouse.id,code:fromWarehouse.code,name:fromWarehouse.name,newQty:sourceQty},
      toWarehouse:{id:toWarehouse.id,code:toWarehouse.code,name:toWarehouse.name,newQty:destinationQty},
      journalId:null,
      accountingEffect:"NONE_SAME_INVENTORY_ASSET",
    };
  });
}
