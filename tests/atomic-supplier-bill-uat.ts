import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  BillStatus,
  ItemType,
  MovementType,
  NormalBalance,
  POStatus,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-supplier-bill-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);

  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [{ finalizeSupplierBillAtomic }, { prisma }] = await Promise.all([
    import("../lib/accounting/atomic-supplier-bill"),
    import("../src/lib/prisma"),
  ]);

  try {
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

    const [ap, grni, ppv, fallbackCost] = await Promise.all([
      account("UAT-SB-AP", "UAT Supplier Bill Payable", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      account("UAT-SB-GRNI", "UAT Supplier Bill GRNI", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      account("UAT-SB-PPV", "UAT Supplier Bill PPV", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
      account("UAT-SB-COST", "UAT Supplier Bill Cost", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const supplier = await prisma.supplier.create({
      data: {
        code: `UAT-SB-SUP-${process.pid}`,
        name: "UAT Atomic Supplier",
        isActive: true,
      },
    });

    const item = await prisma.item.create({
      data: {
        code: `UAT-SB-ITEM-${process.pid}`,
        name: "UAT Atomic Supplier Stock Item",
        type: ItemType.GOOD,
        unit: "PCS",
        trackQty: true,
        purchasePrice: 20,
        sellPrice: 30,
        costAccount: `ACC-${fallbackCost.code}`,
        isActive: true,
      },
    });

    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        code: `UAT-SB-PO-${process.pid}`,
        supplierId: supplier.id,
        orderDate: new Date("2099-03-01T00:00:00+10:00"),
        status: POStatus.RECEIVED,
        subtotal: 100,
        total: 100,
        amountReceived: 100,
        createdBy: "atomic-supplier-bill-uat",
        lines: {
          create: [{
            lineNo: 1,
            itemId: item.id,
            description: "UAT stock item",
            quantity: 5,
            receivedQty: 5,
            unitPrice: 20,
            unit: "PCS",
            amount: 100,
          }],
        },
      },
    });

    await prisma.stockMovement.create({
      data: {
        id: `UAT-SB-RECEIPT-${process.pid}`,
        itemId: item.id,
        type: MovementType.PURCHASE_RECEIPT,
        quantity: 5,
        unitCost: 20,
        totalCost: 100,
        referenceType: "PURCHASE_RECEIPT",
        referenceId: purchaseOrder.id,
        createdAt: new Date("2099-03-02T00:00:00+10:00"),
        createdBy: "atomic-supplier-bill-uat",
      },
    });

    const bill = await prisma.supplierBill.create({
      data: {
        code: `UAT-SB-BILL-${process.pid}`,
        supplierId: supplier.id,
        orderId: purchaseOrder.id,
        billDate: new Date("2099-03-05T00:00:00+10:00"),
        status: BillStatus.DRAFT,
        subtotal: 110,
        total: 110,
        amountPaid: 0,
        outstanding: 110,
        glPosted: false,
        createdBy: "atomic-supplier-bill-uat",
        lines: {
          create: [{
            lineNo: 1,
            itemId: item.id,
            description: "UAT stock item invoice",
            quantity: 5,
            unitPrice: 22,
            unit: "PCS",
            amount: 110,
          }],
        },
      },
    });

    const common = {
      billId: bill.id,
      purchaseOrderRef: purchaseOrder.id,
      postingDate: "2099-03-05",
      documentNumber: bill.code,
      reference: "Atomic Supplier Bill UAT",
      stockReceivedButNotBilledAccountId: `ACC-${grni.code}`,
      defaultCostAccountId: `ACC-${fallbackCost.code}`,
      purchasePriceVarianceAccountId: `ACC-${ppv.code}`,
      purchasePriceVarianceTolerancePct: 20,
      approveIfDraft: true,
      createdBy: "atomic-supplier-bill-uat",
      approvedBy: "atomic-supplier-bill-uat",
    };

    let failedPostingRolledBack = false;
    try {
      await finalizeSupplierBillAtomic({
        ...common,
        payableAccountId: "ACC-UAT-SB-MISSING-AP",
      });
    } catch (error) {
      failedPostingRolledBack = /missing accounts/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!failedPostingRolledBack) {
      throw new Error("Invalid Supplier Invoice posting did not fail as expected");
    }

    const [billAfterFailure, poAfterFailure, journalAfterFailure] = await Promise.all([
      prisma.supplierBill.findUnique({ where: { id: bill.id } }),
      prisma.purchaseOrder.findUnique({ where: { id: purchaseOrder.id } }),
      prisma.journalHeader.findFirst({
        where: { sourceDocType: "SUPPLIER_BILL", sourceDocId: bill.id },
      }),
    ]);

    if (
      !billAfterFailure
      || billAfterFailure.status !== BillStatus.DRAFT
      || billAfterFailure.glPosted
      || billAfterFailure.journalId
    ) {
      throw new Error("Supplier Invoice state survived a failed atomic posting");
    }
    if (
      !poAfterFailure
      || poAfterFailure.status !== POStatus.RECEIVED
      || poAfterFailure.billId
    ) {
      throw new Error("Purchase Order billing state survived a failed atomic posting");
    }
    if (journalAfterFailure) {
      throw new Error("Journal survived a failed atomic Supplier Invoice posting");
    }

    const success = await finalizeSupplierBillAtomic({
      ...common,
      payableAccountId: `ACC-${ap.code}`,
    });

    const [committedBill, committedPo, journal] = await Promise.all([
      prisma.supplierBill.findUnique({ where: { id: bill.id } }),
      prisma.purchaseOrder.findUnique({ where: { id: purchaseOrder.id } }),
      prisma.journalHeader.findUnique({
        where: { code: success.journalId },
        include: { lines: { include: { account: true } } },
      }),
    ]);

    if (
      !committedBill
      || committedBill.status !== BillStatus.SENT
      || !committedBill.glPosted
      || committedBill.journalId !== success.journalId
    ) {
      throw new Error("Supplier Invoice did not commit with its journal");
    }
    if (
      !committedPo
      || committedPo.status !== POStatus.BILLED
      || committedPo.billId !== bill.id
    ) {
      throw new Error("Purchase Order billing state was not committed atomically");
    }
    if (
      !journal
      || journal.status !== "POSTED"
      || Number(journal.totalDebit) !== 110
      || Number(journal.totalCredit) !== 110
      || journal.lines.length !== 3
    ) {
      throw new Error("Supplier Invoice journal was not committed correctly");
    }

    const byCode = new Map(
      journal.lines.map((line) => [line.account.code, {
        debit: Number(line.debit),
        credit: Number(line.credit),
      }]),
    );
    const grniLine = byCode.get(grni.code);
    const ppvLine = byCode.get(ppv.code);
    const apLine = byCode.get(ap.code);
    if (!grniLine || grniLine.debit !== 100 || grniLine.credit !== 0) {
      throw new Error("GRNI clearing was not posted at receipt value");
    }
    if (!ppvLine || ppvLine.debit !== 10 || ppvLine.credit !== 0) {
      throw new Error("Purchase Price Variance was not posted correctly");
    }
    if (!apLine || apLine.credit !== 110 || apLine.debit !== 0) {
      throw new Error("Accounts Payable was not posted correctly");
    }

    const duplicate = await finalizeSupplierBillAtomic({
      ...common,
      payableAccountId: `ACC-${ap.code}`,
    });
    const journalCount = await prisma.journalHeader.count({
      where: { sourceDocType: "SUPPLIER_BILL", sourceDocId: bill.id },
    });
    const poAfterDuplicate = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrder.id },
    });

    if (!duplicate.alreadyPosted) {
      throw new Error("Duplicate Supplier Invoice posting was not idempotent");
    }
    if (journalCount !== 1) {
      throw new Error("Duplicate Supplier Invoice posting created another journal");
    }
    if (!poAfterDuplicate || poAfterDuplicate.billId !== bill.id) {
      throw new Error("Duplicate Supplier Invoice posting changed Purchase Order billing state");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      failedPostingRolledBack,
      failedBillStateRolledBack:
        billAfterFailure.status === BillStatus.DRAFT
        && !billAfterFailure.glPosted
        && !billAfterFailure.approvedAt
        && !billAfterFailure.journalId,
      failedPoStateRolledBack:
        poAfterFailure.status === POStatus.RECEIVED
        && !poAfterFailure.billId,
      failedJournalRolledBack: journalAfterFailure === null,
      successfulBillCommitted:
        committedBill.status === BillStatus.SENT
        && committedBill.glPosted === true
        && Boolean(committedBill.approvedAt)
        && committedBill.journalId === journal.code,
      successfulPoStatusCommitted:
        committedPo.status === POStatus.BILLED
        && committedPo.billId === bill.id,
      successfulJournalCommitted: journal.status === "POSTED",
      successfulJournalBalanced:
        Number(journal.totalDebit) === Number(journal.totalCredit),
      grniClearedAtReceiptValue: grniLine?.debit === 100,
      purchasePriceVariancePosted: ppvLine?.debit === 10,
      accountsPayablePosted: apLine?.credit === 110,
      billJournalLinked: committedBill.journalId === journal.code,
      duplicatePostingBlocked:
        duplicate.alreadyPosted === true
        && journalCount === 1,
      duplicateDidNotChangePo:
        poAfterDuplicate.billId === bill.id
        && poAfterDuplicate.status === POStatus.BILLED,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
      throw new Error("Unsafe UAT cleanup path");
    }
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
