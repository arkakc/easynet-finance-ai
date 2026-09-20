import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  ItemType,
  MovementType,
  NormalBalance,
  POStatus,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-stock-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { postPurchaseReceiptAtomic, postStockMovementAtomic, postStockValueAdjustmentAtomic },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-stock"),
    import("../src/lib/prisma"),
  ]);

  try {
    const account = async (code:string,name:string,type:AccountTypeGL,normalBalance:NormalBalance) =>
      prisma.chartOfAccounts.upsert({
        where:{code},
        update:{name,type,normalBalance,parentId:null,isActive:true},
        create:{code,name,type,normalBalance,isActive:true},
      });

    const [inventory,cogs,adjustment,clearing,grni] = await Promise.all([
      account("UAT-STK-INV","UAT Stock Inventory",AccountTypeGL.ASSET,NormalBalance.DEBIT),
      account("UAT-STK-COGS","UAT Stock COGS",AccountTypeGL.EXPENSE,NormalBalance.DEBIT),
      account("UAT-STK-ADJ","UAT Stock Adjustment",AccountTypeGL.EXPENSE,NormalBalance.DEBIT),
      account("UAT-STK-CLR","UAT Stock Clearing",AccountTypeGL.LIABILITY,NormalBalance.CREDIT),
      account("UAT-STK-GRNI","UAT Stock GRNI",AccountTypeGL.LIABILITY,NormalBalance.CREDIT),
    ]);

    await prisma.globalSettings.upsert({
      where:{key:"posting_lock_date"},
      create:{key:"posting_lock_date",value:"2098-12-31"},
      update:{value:"2098-12-31"},
    });

    const item = await prisma.item.create({
      data:{
        code:`UAT-STK-ITEM-${process.pid}`,
        name:"UAT Atomic Stock Item",
        type:ItemType.GOOD,
        unit:"PCS",
        trackQty:true,
        purchasePrice:20,
        sellPrice:99,
        costAccount:`ACC-${cogs.code}`,
        inventoryAsset:`ACC-${inventory.code}`,
        isActive:true,
      },
    });

    await prisma.stockMovement.create({
      data:{
        id:`UAT-STK-OPEN-${process.pid}`,
        itemId:item.id,
        type:MovementType.PURCHASE_RECEIPT,
        quantity:10,
        unitCost:20,
        totalCost:200,
        referenceType:"UAT_OPENING",
        referenceId:`UAT-STK-OPEN-${process.pid}`,
        createdAt:new Date("2099-05-01T00:00:00+10:00"),
        createdBy:"atomic-stock-uat",
      },
    });

    const failedMovementId=`UAT-STK-FAIL-${process.pid}`;
    let failedMovementRolledBack=false;
    try {
      await postStockMovementAtomic({
        movementId:failedMovementId,
        postingDate:"2099-05-02",
        itemRef:item.id,
        movementType:"PROJECT_ISSUE",
        qty:2,
        inventoryAccountId:"ACC-UAT-STK-MISSING-INV",
        defaultCostAccountId:`ACC-${cogs.code}`,
        stockAdjustmentAccountId:`ACC-${adjustment.code}`,
        expensesIncludedInValuationAccountId:`ACC-${clearing.code}`,
        createdBy:"atomic-stock-uat",
      });
    } catch (error) {
      failedMovementRolledBack=/missing accounts/i.test(error instanceof Error?error.message:String(error));
    }
    if(!failedMovementRolledBack) throw new Error("Invalid stock movement did not fail");
    if(await prisma.stockMovement.findUnique({where:{id:failedMovementId}})) throw new Error("Failed stock movement survived rollback");

    const movementId=`UAT-STK-ISSUE-${process.pid}`;
    const issue=await postStockMovementAtomic({
      movementId,
      postingDate:"2099-05-02",
      itemRef:item.id,
      movementType:"PROJECT_ISSUE",
      qty:2,
      inventoryAccountId:`ACC-${inventory.code}`,
      defaultCostAccountId:`ACC-${cogs.code}`,
      stockAdjustmentAccountId:`ACC-${adjustment.code}`,
      expensesIncludedInValuationAccountId:`ACC-${clearing.code}`,
      createdBy:"atomic-stock-uat",
    });
    const [issueMovement,issueJournal,itemAfterIssue]=await Promise.all([
      prisma.stockMovement.findUnique({where:{id:movementId}}),
      prisma.journalHeader.findUnique({where:{code:issue.journalId}}),
      prisma.item.findUnique({where:{id:item.id}}),
    ]);
    if(!issueMovement||Number(issueMovement.totalCost)!==40||issueMovement.journalId!==issue.journalId) throw new Error("Atomic stock issue did not commit correctly");
    if(!issueJournal||Number(issueJournal.totalDebit)!==40||Number(issueJournal.totalCredit)!==40) throw new Error("Stock issue journal is not balanced");
    if(Number(itemAfterIssue?.sellPrice)!==99) throw new Error("Stock valuation incorrectly changed selling price");

    const failedAdjustmentId=`UAT-STK-VAL-FAIL-${process.pid}`;
    let failedAdjustmentRolledBack=false;
    try {
      await postStockValueAdjustmentAtomic({
        movementId:failedAdjustmentId,
        postingDate:"2099-05-03",
        itemRef:item.id,
        adjustmentType:"LANDED_COST",
        amount:16,
        targetUnitCost:0,
        inventoryAccountId:`ACC-${inventory.code}`,
        defaultCostAccountId:`ACC-${cogs.code}`,
        stockAdjustmentAccountId:`ACC-${adjustment.code}`,
        expensesIncludedInValuationAccountId:"ACC-UAT-STK-MISSING-CLEARING",
        createdBy:"atomic-stock-uat",
      });
    } catch (error) {
      failedAdjustmentRolledBack=/missing accounts/i.test(error instanceof Error?error.message:String(error));
    }
    if(!failedAdjustmentRolledBack) throw new Error("Invalid value adjustment did not fail");
    if(await prisma.stockMovement.findUnique({where:{id:failedAdjustmentId}})) throw new Error("Failed value adjustment survived rollback");

    const landedId=`UAT-STK-LC-${process.pid}`;
    const landed=await postStockValueAdjustmentAtomic({
      movementId:landedId,
      postingDate:"2099-05-03",
      itemRef:item.id,
      adjustmentType:"LANDED_COST",
      amount:16,
      targetUnitCost:0,
      inventoryAccountId:`ACC-${inventory.code}`,
      defaultCostAccountId:`ACC-${cogs.code}`,
      stockAdjustmentAccountId:`ACC-${adjustment.code}`,
      expensesIncludedInValuationAccountId:`ACC-${clearing.code}`,
      createdBy:"atomic-stock-uat",
    });
    const landedMovement=await prisma.stockMovement.findUnique({where:{id:landedId}});
    if(!landedMovement||Number(landedMovement.totalCost)!==16||landedMovement.journalId!==landed.journalId) throw new Error("Landed cost adjustment did not commit");

    const nrvId=`UAT-STK-NRV-${process.pid}`;
    const nrv=await postStockValueAdjustmentAtomic({
      movementId:nrvId,
      postingDate:"2099-05-04",
      itemRef:item.id,
      adjustmentType:"NRV_WRITEDOWN",
      amount:0,
      targetUnitCost:21,
      inventoryAccountId:`ACC-${inventory.code}`,
      defaultCostAccountId:`ACC-${cogs.code}`,
      stockAdjustmentAccountId:`ACC-${adjustment.code}`,
      expensesIncludedInValuationAccountId:`ACC-${clearing.code}`,
      createdBy:"atomic-stock-uat",
    });
    const nrvMovement=await prisma.stockMovement.findUnique({where:{id:nrvId}});
    if(!nrvMovement||Number(nrvMovement.totalCost)!==-8||nrvMovement.journalId!==nrv.journalId) throw new Error("NRV write-down did not preserve signed stock value");

    const supplier=await prisma.supplier.create({
      data:{code:`UAT-STK-SUP-${process.pid}`,name:"UAT Stock Supplier",isActive:true},
    });
    const receiptItem=await prisma.item.create({
      data:{
        code:`UAT-STK-RCV-${process.pid}`,name:"UAT Receipt Item",type:ItemType.GOOD,unit:"PCS",trackQty:true,
        purchasePrice:30,sellPrice:50,costAccount:`ACC-${cogs.code}`,inventoryAsset:`ACC-${inventory.code}`,isActive:true,
      },
    });
    const po=await prisma.purchaseOrder.create({
      data:{
        code:`UAT-STK-PO-${process.pid}`,supplierId:supplier.id,orderDate:new Date("2099-05-05T00:00:00+10:00"),status:POStatus.SENT,
        subtotal:150,total:150,createdBy:"atomic-stock-uat",
        lines:{create:[{lineNo:1,itemId:receiptItem.id,description:"Receipt item",quantity:5,unitPrice:30,unit:"PCS",amount:150}]},
      },
    });

    const failedReceiptNo=`UAT-PR-FAIL-${process.pid}`;
    let failedReceiptRolledBack=false;
    try {
      await postPurchaseReceiptAtomic({
        receiptNumber:failedReceiptNo,postingDate:"2099-05-06",purchaseOrderRef:po.id,
        lines:[{itemRef:receiptItem.id,qty:5}],inventoryAccountId:`ACC-${inventory.code}`,grniAccountId:"ACC-UAT-STK-MISSING-GRNI",
        createdBy:"atomic-stock-uat",
      });
    } catch (error) {
      failedReceiptRolledBack=/missing accounts/i.test(error instanceof Error?error.message:String(error));
    }
    if(!failedReceiptRolledBack) throw new Error("Invalid Purchase Receipt did not fail");
    const [failedReceiptMovements,poAfterFailure]=await Promise.all([
      prisma.stockMovement.count({where:{referenceId:po.id,type:MovementType.PURCHASE_RECEIPT}}),
      prisma.purchaseOrder.findUnique({where:{id:po.id}}),
    ]);
    if(failedReceiptMovements!==0||poAfterFailure?.status!==POStatus.SENT) throw new Error("Purchase Receipt failure did not roll back stock and PO state");

    const receiptNo=`UAT-PR-${process.pid}`;
    const receipt=await postPurchaseReceiptAtomic({
      receiptNumber:receiptNo,postingDate:"2099-05-06",purchaseOrderRef:po.id,
      lines:[{itemRef:receiptItem.id,qty:5}],inventoryAccountId:`ACC-${inventory.code}`,grniAccountId:`ACC-${grni.code}`,
      createdBy:"atomic-stock-uat",
    });
    const [receiptMovements,poCommitted,receiptJournal]=await Promise.all([
      prisma.stockMovement.findMany({where:{referenceId:po.id,type:MovementType.PURCHASE_RECEIPT}}),
      prisma.purchaseOrder.findUnique({where:{id:po.id}}),
      prisma.journalHeader.findUnique({where:{code:receipt.journalId}}),
    ]);
    if(receiptMovements.length!==1||Number(receiptMovements[0].totalCost)!==150||receiptMovements[0].journalId!==receipt.journalId) throw new Error("Purchase Receipt stock did not commit atomically");
    if(poCommitted?.status!==POStatus.RECEIVED) throw new Error("Purchase Order receipt status did not commit atomically");
    if(!receiptJournal||Number(receiptJournal.totalDebit)!==150||Number(receiptJournal.totalCredit)!==150) throw new Error("Purchase Receipt journal is not balanced");

    console.log(JSON.stringify({
      database:"temporary clone",
      liveDatabaseChanged:false,
      failedMovementRolledBack,
      successfulMovementCommitted:Boolean(issueMovement),
      successfulMovementJournalBalanced:Number(issueJournal.totalDebit)===Number(issueJournal.totalCredit),
      sellPriceUnchangedByValuation:Number(itemAfterIssue.sellPrice)===99,
      failedAdjustmentRolledBack,
      landedCostCommitted:Number(landedMovement.totalCost)===16,
      nrvSignedValuePreserved:Number(nrvMovement.totalCost)===-8,
      failedReceiptRolledBack,
      failedReceiptPoStateRolledBack:poAfterFailure.status===POStatus.SENT,
      successfulReceiptCommitted:receiptMovements.length===1,
      successfulReceiptPoStatusCommitted:poCommitted.status===POStatus.RECEIVED,
      successfulReceiptJournalBalanced:Number(receiptJournal.totalDebit)===Number(receiptJournal.totalCredit),
    },null,2));
  } finally {
    await prisma.$disconnect();
    const resolved=path.resolve(temporaryRoot), root=path.resolve(os.tmpdir());
    if(!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved,{recursive:true,force:true});
  }
}
main().catch((error)=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
