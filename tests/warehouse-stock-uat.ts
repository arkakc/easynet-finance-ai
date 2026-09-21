import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  ItemType,
  NormalBalance,
  POStatus,
  QuoteStatus,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-warehouse-stock-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = \`file:\${temporaryDatabase.replace(/\\\\/g, "/")}\`;

  const [
    {
      postPurchaseReceiptAtomic,
      postStockMovementAtomic,
      postStockValueAdjustmentAtomic,
      transferStockAtomic,
    },
    { postSalesDeliveryAtomic },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-stock"),
    import("../lib/accounting/atomic-sales-delivery"),
    import("../src/lib/prisma"),
  ]);

  try {
    const suffix = String(process.pid);
    const account = async (
      code: string,
      name: string,
      type: AccountTypeGL,
      normalBalance: NormalBalance,
    ) => prisma.chartOfAccounts.upsert({
      where: { code },
      update: { name, type, normalBalance, parentId: null, isActive: true },
      create: { code, name, type, normalBalance, isActive: true },
    });

    const [inventory, cogs, adjustment, clearing, grni] = await Promise.all([
      account(\`UAT-WH-INV-\${suffix}\`, "UAT Warehouse Inventory", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      account(\`UAT-WH-COGS-\${suffix}\`, "UAT Warehouse COGS", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
      account(\`UAT-WH-ADJ-\${suffix}\`, "UAT Warehouse Adjustment", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
      account(\`UAT-WH-CLR-\${suffix}\`, "UAT Warehouse Clearing", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      account(\`UAT-WH-GRNI-\${suffix}\`, "UAT Warehouse GRNI", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const [pom, lae] = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: \`POM-\${suffix}\`,
          name: "POM UAT Warehouse",
          location: "Port Moresby",
          isDefault: true,
          isActive: true,
        },
      }),
      prisma.warehouse.create({
        data: {
          code: \`LAE-\${suffix}\`,
          name: "Lae UAT Warehouse",
          location: "Lae",
          isDefault: false,
          isActive: true,
        },
      }),
    ]);

    const item = await prisma.item.create({
      data: {
        code: \`UAT-WH-ITEM-\${suffix}\`,
        name: "UAT Warehouse Item",
        type: ItemType.GOOD,
        unit: "PCS",
        trackQty: true,
        purchasePrice: 20,
        sellPrice: 50,
        costAccount: \`ACC-\${cogs.code}\`,
        inventoryAsset: \`ACC-\${inventory.code}\`,
        isActive: true,
      },
    });

    await postStockMovementAtomic({
      movementId: \`UAT-WH-OPEN-\${suffix}\`,
      postingDate: "2099-08-01",
      itemRef: item.id,
      warehouseRef: pom.id,
      movementType: "ADJUSTMENT_IN",
      qty: 10,
      unitCost: 20,
      inventoryAccountId: \`ACC-\${inventory.code}\`,
      defaultCostAccountId: \`ACC-\${cogs.code}\`,
      stockAdjustmentAccountId: \`ACC-\${adjustment.code}\`,
      expensesIncludedInValuationAccountId: \`ACC-\${clearing.code}\`,
      createdBy: "warehouse-stock-uat",
    });

    let crossWarehouseNegativeBlocked = false;
    try {
      await postStockMovementAtomic({
        movementId: \`UAT-WH-BLOCK-\${suffix}\`,
        postingDate: "2099-08-02",
        itemRef: item.id,
        warehouseRef: lae.id,
        movementType: "PROJECT_ISSUE",
        qty: 1,
        inventoryAccountId: \`ACC-\${inventory.code}\`,
        defaultCostAccountId: \`ACC-\${cogs.code}\`,
        stockAdjustmentAccountId: \`ACC-\${adjustment.code}\`,
        expensesIncludedInValuationAccountId: \`ACC-\${clearing.code}\`,
        createdBy: "warehouse-stock-uat",
      });
    } catch (error) {
      crossWarehouseNegativeBlocked = /insufficient stock in/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!crossWarehouseNegativeBlocked) {
      throw new Error("Warehouse-specific negative stock protection failed");
    }

    const transfer = await transferStockAtomic({
      transferId: \`UAT-TRF-\${suffix}\`,
      postingDate: "2099-08-02",
      itemRef: item.id,
      fromWarehouseRef: pom.id,
      toWarehouseRef: lae.id,
      qty: 4,
      sourceDocumentId: \`UAT-TRANSFER-REQ-\${suffix}\`,
      createdBy: "warehouse-stock-uat",
    });

    const [pomAfterTransfer, laeAfterTransfer, transferMovements] = await Promise.all([
      prisma.warehouseStockBalance.findUnique({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId: pom.id } },
      }),
      prisma.warehouseStockBalance.findUnique({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId: lae.id } },
      }),
      prisma.stockMovement.findMany({
        where: { transferId: transfer.transferId },
        orderBy: { type: "asc" },
      }),
    ]);

    if (
      !pomAfterTransfer
      || !laeAfterTransfer
      || Number(pomAfterTransfer.quantity) !== 6
      || Number(laeAfterTransfer.quantity) !== 4
    ) throw new Error("Warehouse transfer quantities are incorrect");
    if (
      Number(pomAfterTransfer.stockValue) + Number(laeAfterTransfer.stockValue) !== 200
    ) throw new Error("Warehouse transfer changed company inventory book value");
    if (
      transferMovements.length !== 2
      || transferMovements.some((row) => Boolean(row.journalId))
    ) throw new Error("Warehouse transfer did not preserve its no-GL internal movement design");

    await postStockMovementAtomic({
      movementId: \`UAT-WH-LAE-IN-\${suffix}\`,
      postingDate: "2099-08-03",
      itemRef: item.id,
      warehouseRef: lae.id,
      movementType: "ADJUSTMENT_IN",
      qty: 2,
      unitCost: 30,
      inventoryAccountId: \`ACC-\${inventory.code}\`,
      defaultCostAccountId: \`ACC-\${cogs.code}\`,
      stockAdjustmentAccountId: \`ACC-\${adjustment.code}\`,
      expensesIncludedInValuationAccountId: \`ACC-\${clearing.code}\`,
      createdBy: "warehouse-stock-uat",
    });

    const laeAfterAdjustment = await prisma.warehouseStockBalance.findUnique({
      where: { itemId_warehouseId: { itemId: item.id, warehouseId: lae.id } },
    });
    if (
      !laeAfterAdjustment
      || Number(laeAfterAdjustment.quantity) !== 6
      || Number(laeAfterAdjustment.stockValue) !== 140
    ) throw new Error("Independent warehouse moving-average valuation failed");

    await postStockValueAdjustmentAtomic({
      movementId: \`UAT-WH-POM-LC-\${suffix}\`,
      postingDate: "2099-08-04",
      itemRef: item.id,
      warehouseRef: pom.id,
      adjustmentType: "LANDED_COST",
      amount: 12,
      targetUnitCost: 0,
      inventoryAccountId: \`ACC-\${inventory.code}\`,
      defaultCostAccountId: \`ACC-\${cogs.code}\`,
      stockAdjustmentAccountId: \`ACC-\${adjustment.code}\`,
      expensesIncludedInValuationAccountId: \`ACC-\${clearing.code}\`,
      createdBy: "warehouse-stock-uat",
    });

    const pomAfterLanded = await prisma.warehouseStockBalance.findUnique({
      where: { itemId_warehouseId: { itemId: item.id, warehouseId: pom.id } },
    });
    if (!pomAfterLanded || Number(pomAfterLanded.stockValue) !== 132) {
      throw new Error("Warehouse-specific landed cost valuation failed");
    }

    const supplier = await prisma.supplier.create({
      data: {
        code: \`UAT-WH-SUP-\${suffix}\`,
        name: "UAT Warehouse Supplier",
        isActive: true,
      },
    });
    const po = await prisma.purchaseOrder.create({
      data: {
        code: \`UAT-WH-PO-\${suffix}\`,
        supplierId: supplier.id,
        orderDate: new Date("2099-08-05T00:00:00+10:00"),
        status: POStatus.SENT,
        subtotal: 125,
        total: 125,
        createdBy: "warehouse-stock-uat",
        lines: {
          create: [{
            lineNo: 1,
            itemId: item.id,
            description: "Warehouse receipt item",
            quantity: 5,
            unitPrice: 25,
            unit: "PCS",
            amount: 125,
          }],
        },
      },
    });

    const receipt = await postPurchaseReceiptAtomic({
      receiptNumber: \`UAT-WH-PR-\${suffix}\`,
      postingDate: "2099-08-06",
      purchaseOrderRef: po.id,
      warehouseRef: lae.id,
      lines: [{ itemRef: item.id, qty: 5 }],
      inventoryAccountId: \`ACC-\${inventory.code}\`,
      grniAccountId: \`ACC-\${grni.code}\`,
      createdBy: "warehouse-stock-uat",
    });

    const laeAfterReceipt = await prisma.warehouseStockBalance.findUnique({
      where: { itemId_warehouseId: { itemId: item.id, warehouseId: lae.id } },
    });
    if (
      !laeAfterReceipt
      || Number(laeAfterReceipt.quantity) !== 11
      || Number(laeAfterReceipt.stockValue) !== 265
      || receipt.warehouse.id !== lae.id
    ) throw new Error("Purchase Receipt did not post into the selected warehouse");

    const customer = await prisma.customer.create({
      data: {
        code: \`UAT-WH-CUST-\${suffix}\`,
        name: "UAT Warehouse Customer",
        isActive: true,
      },
    });
    const salesOrder = await prisma.quote.create({
      data: {
        code: \`SO-UAT-WH-\${suffix}\`,
        customerId: customer.id,
        issuedDate: new Date("2099-08-07T00:00:00+10:00"),
        status: QuoteStatus.ACCEPTED,
        subtotal: 100,
        total: 100,
        createdBy: "warehouse-stock-uat",
        lines: {
          create: [{
            lineNo: 1,
            itemId: item.id,
            description: "Warehouse delivery item",
            quantity: 2,
            unitPrice: 50,
            amount: 100,
          }],
        },
      },
    });

    const delivery = await postSalesDeliveryAtomic({
      deliveryNumber: \`DN-UAT-WH-\${suffix}\`,
      postingDate: "2099-08-08",
      salesOrderRef: salesOrder.id,
      warehouseRef: lae.id,
      inventoryAccountId: \`ACC-\${inventory.code}\`,
      defaultCostAccountId: \`ACC-\${cogs.code}\`,
      createdBy: "warehouse-stock-uat",
      approvedBy: "Finance Controller",
    });

    const [laeAfterDelivery, pomFinal, deliveryMovements, deliveryJournal] = await Promise.all([
      prisma.warehouseStockBalance.findUnique({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId: lae.id } },
      }),
      prisma.warehouseStockBalance.findUnique({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId: pom.id } },
      }),
      prisma.stockMovement.findMany({
        where: { referenceId: salesOrder.id, type: "SALES_DELIVERY" },
      }),
      prisma.journalHeader.findUnique({ where: { code: delivery.journalId } }),
    ]);

    if (
      !laeAfterDelivery
      || Number(laeAfterDelivery.quantity) !== 9
      || deliveryMovements.length !== 1
      || deliveryMovements[0].warehouseId !== lae.id
    ) throw new Error("Sales delivery did not consume the selected warehouse");
    if (!pomFinal || Number(pomFinal.quantity) !== 6) {
      throw new Error("Sales delivery incorrectly consumed another warehouse");
    }
    if (
      !deliveryJournal
      || Number(deliveryJournal.totalDebit) !== Number(deliveryJournal.totalCredit)
    ) throw new Error("Warehouse sales delivery journal is not balanced");

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      warehouseSpecificNegativeStockBlocked: crossWarehouseNegativeBlocked,
      transferCreatedPairedMovements: transferMovements.length === 2,
      transferHasNoGlEffect: transferMovements.every((row) => !row.journalId),
      transferPreservedCompanyValue:
        Number(pomAfterTransfer.stockValue) + Number(laeAfterTransfer.stockValue) === 200,
      sourceWarehouseBalanceCorrect: Number(pomAfterTransfer.quantity) === 6,
      destinationWarehouseBalanceCorrect: Number(laeAfterTransfer.quantity) === 4,
      warehouseMovingAverageIndependent:
        Number(laeAfterAdjustment.stockValue) === 140
        && Number(laeAfterAdjustment.quantity) === 6,
      warehouseValueAdjustmentCommitted: Number(pomAfterLanded.stockValue) === 132,
      purchaseReceiptSelectedWarehouse: receipt.warehouse.id === lae.id,
      purchaseReceiptWarehouseBalanceCommitted: Number(laeAfterReceipt.quantity) === 11,
      salesDeliverySelectedWarehouse: deliveryMovements[0].warehouseId === lae.id,
      salesDeliveryOtherWarehouseUntouched: Number(pomFinal.quantity) === 6,
      salesDeliveryJournalBalanced:
        Number(deliveryJournal.totalDebit) === Number(deliveryJournal.totalCredit),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolved = path.resolve(temporaryRoot);
    const root = path.resolve(os.tmpdir());
    if (!resolved.startsWith(\`\${root}\${path.sep}\`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
