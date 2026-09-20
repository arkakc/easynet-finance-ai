import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  ItemType,
  MovementType,
  NormalBalance,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-sales-return-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { postSalesCreditNoteAtomic },
    { ensurePaymentScheduleInfrastructure, findPaymentSchedules, insertPaymentSchedule },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-sales-return"),
    import("../lib/accounting/payment-schedule-store"),
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
      update: { name, type, normalBalance, isActive: true },
      create: { code, name, type, normalBalance, isActive: true },
    });

    const [revenue, gstPayable, receivable, customerAdvance, inventory, cogs] = await Promise.all([
      account("4100", "UAT Sales Revenue", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
      account("2120", "UAT Output GST", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      account("1130", "UAT Accounts Receivable", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      account("2150", "UAT Customer Advances", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      account("1150", "UAT Inventory", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      account("5100", "UAT Cost of Goods Sold", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    await ensurePaymentScheduleInfrastructure(prisma);

    const customer = await prisma.customer.create({
      data: {
        code: `UAT-RET-CUST-${process.pid}`,
        name: "UAT Sales Return Customer",
        isActive: true,
      },
    });
    const item = await prisma.item.create({
      data: {
        code: `UAT-RET-ITEM-${process.pid}`,
        name: "UAT Sales Return Item",
        type: ItemType.GOOD,
        unit: "PCS",
        trackQty: true,
        purchasePrice: 30,
        sellPrice: 50,
        revenueAccount: `ACC-${revenue.code}`,
        costAccount: `ACC-${cogs.code}`,
        inventoryAsset: `ACC-${inventory.code}`,
        isActive: true,
      },
    });

    const original = await prisma.invoice.create({
      data: {
        code: `UAT-RET-INV-${process.pid}`,
        customerId: customer.id,
        issuedDate: new Date("2099-06-10T00:00:00+10:00"),
        subtotal: 100,
        taxTotal: 10,
        total: 110,
        amountPaid: 20,
        outstanding: 90,
        status: "PARTIAL",
        glPosted: true,
        journalId: `UAT-RET-ORIG-JRN-${process.pid}`,
        createdBy: "atomic-sales-return-uat",
        lines: {
          create: [{
            lineNo: 1,
            itemId: item.id,
            description: "Original stock sale",
            quantity: 2,
            unitPrice: 50,
            unit: "PCS",
            taxRate: 10,
            taxAmount: 10,
            amount: 100,
            revenueAccount: `ACC-${revenue.code}`,
          }],
        },
      },
    });

    await prisma.stockMovement.create({
      data: {
        id: `UAT-RET-ISSUE-${process.pid}`,
        itemId: item.id,
        type: MovementType.SALES_ISSUE,
        quantity: 2,
        unitCost: 30,
        totalCost: 60,
        referenceType: "SALES_ISSUE",
        referenceId: original.id,
        journalId: original.journalId,
        createdAt: new Date("2099-06-10T00:00:00+10:00"),
        createdBy: "atomic-sales-return-uat",
      },
    });

    const credit = await prisma.invoice.create({
      data: {
        code: `CN-UAT-${process.pid}`,
        customerId: customer.id,
        issuedDate: new Date("2099-06-12T00:00:00+10:00"),
        subtotal: 50,
        taxTotal: 5,
        total: 55,
        amountPaid: 0,
        outstanding: 0,
        status: "DRAFT",
        glPosted: false,
        sourceDocId: original.id,
        createdBy: "atomic-sales-return-uat",
        lines: {
          create: [{
            lineNo: 1,
            itemId: item.id,
            description: "Returned stock item",
            quantity: 1,
            unitPrice: 50,
            unit: "PCS",
            taxRate: 10,
            taxAmount: 5,
            amount: 50,
            revenueAccount: `ACC-${revenue.code}`,
          }],
        },
      },
    });

    const reasonId = `UAT-RET-REASON-${process.pid}`;
    await insertPaymentSchedule({
      scheduleId: reasonId,
      sourceType: "SALES_RETURN_REASON",
      sourceId: credit.id,
      partyId: customer.code,
      milestone: "Customer returned one faulty item",
      dueDate: "2099-06-12",
      percentage: 0,
      amount: 55,
      status: "PENDING",
    }, "atomic-sales-return-uat", prisma);

    await prisma.chartOfAccounts.update({
      where: { id: revenue.id },
      data: { isActive: false },
    });

    let failedPostingRolledBack = false;
    try {
      await postSalesCreditNoteAtomic({
        creditNoteId: credit.id,
        approveIfDraft: true,
        createdBy: "atomic-sales-return-uat",
        approvedBy: "atomic-sales-return-uat",
      });
    } catch (error) {
      failedPostingRolledBack = /inactive accounts/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!failedPostingRolledBack) {
      throw new Error("Invalid Sales Credit Note posting did not fail as expected");
    }

    const [creditAfterFailure, originalAfterFailure, returnsAfterFailure, reasonAfterFailure, journalAfterFailure] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: credit.id } }),
      prisma.invoice.findUnique({ where: { id: original.id } }),
      prisma.stockMovement.findMany({
        where: { type: MovementType.RETURN_IN, referenceId: credit.id },
      }),
      findPaymentSchedules("SALES_RETURN_REASON", credit.id),
      prisma.journalHeader.findFirst({
        where: { sourceDocType: "SALES_CREDIT_NOTE", sourceDocId: credit.id },
      }),
    ]);

    if (
      !creditAfterFailure
      || creditAfterFailure.status !== "DRAFT"
      || creditAfterFailure.glPosted
      || creditAfterFailure.journalId
      || creditAfterFailure.approvedAt
    ) {
      throw new Error("Credit Note approval/GL state survived failed posting");
    }
    if (
      !originalAfterFailure
      || Number(originalAfterFailure.amountPaid) !== 20
      || Number(originalAfterFailure.outstanding) !== 90
      || originalAfterFailure.status !== "PARTIAL"
    ) {
      throw new Error("Original AR settlement survived failed Credit Note posting");
    }
    if (returnsAfterFailure.length) throw new Error("Stock return survived failed Credit Note posting");
    if (reasonAfterFailure[0]?.status !== "PENDING") throw new Error("Return reason status survived failed posting");
    if (journalAfterFailure) throw new Error("Credit Note journal survived failed posting");

    await prisma.chartOfAccounts.update({
      where: { id: revenue.id },
      data: { isActive: true },
    });
    for (const row of [gstPayable, receivable, customerAdvance, inventory, cogs]) {
      await prisma.chartOfAccounts.update({
        where: { id: row.id },
        data: { isActive: true },
      });
    }

    const success = await postSalesCreditNoteAtomic({
      creditNoteId: credit.id,
      approveIfDraft: true,
      createdBy: "atomic-sales-return-uat",
      approvedBy: "atomic-sales-return-uat",
    });

    const [committedCredit, committedOriginal, committedReturns, committedReason, journal] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: credit.id } }),
      prisma.invoice.findUnique({ where: { id: original.id } }),
      prisma.stockMovement.findMany({
        where: { type: MovementType.RETURN_IN, referenceId: credit.id },
      }),
      findPaymentSchedules("SALES_RETURN_REASON", credit.id),
      prisma.journalHeader.findUnique({
        where: { code: success.journalId },
        include: { lines: { include: { account: true } } },
      }),
    ]);

    if (
      !committedCredit
      || committedCredit.status !== "SENT"
      || !committedCredit.glPosted
      || !committedCredit.approvedAt
      || committedCredit.journalId !== success.journalId
    ) {
      throw new Error("Credit Note approval and posting did not commit atomically");
    }
    if (
      !committedOriginal
      || committedOriginal.status !== "PARTIAL"
      || Number(committedOriginal.amountPaid) !== 75
      || Number(committedOriginal.outstanding) !== 35
    ) {
      throw new Error("Original Sales Invoice AR was not reduced atomically");
    }
    if (
      committedReturns.length !== 1
      || Number(committedReturns[0].quantity) !== 1
      || Number(committedReturns[0].totalCost) !== 30
      || committedReturns[0].journalId !== success.journalId
    ) {
      throw new Error("Sales Return stock movement did not commit atomically");
    }
    if (committedReason[0]?.status !== "POSTED") {
      throw new Error("Sales Return reason status did not commit atomically");
    }
    if (
      !journal
      || journal.status !== "POSTED"
      || Number(journal.totalDebit) !== 85
      || Number(journal.totalCredit) !== 85
    ) {
      throw new Error("Sales Credit Note journal was not committed correctly");
    }

    const duplicate = await postSalesCreditNoteAtomic({
      creditNoteId: credit.id,
      approveIfDraft: true,
    });
    const [returnCountAfterDuplicate, journalCountAfterDuplicate, originalAfterDuplicate] = await Promise.all([
      prisma.stockMovement.count({
        where: { type: MovementType.RETURN_IN, referenceId: credit.id },
      }),
      prisma.journalHeader.count({
        where: { sourceDocType: "SALES_CREDIT_NOTE", sourceDocId: credit.id },
      }),
      prisma.invoice.findUnique({ where: { id: original.id } }),
    ]);

    if (!duplicate.alreadyPosted) throw new Error("Duplicate Credit Note posting was not idempotent");
    if (returnCountAfterDuplicate !== 1 || journalCountAfterDuplicate !== 1) {
      throw new Error("Duplicate Credit Note posting duplicated stock or GL");
    }
    if (
      !originalAfterDuplicate
      || Number(originalAfterDuplicate.amountPaid) !== 75
      || Number(originalAfterDuplicate.outstanding) !== 35
    ) {
      throw new Error("Duplicate Credit Note posting changed AR twice");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      failedPostingRolledBack,
      failedApprovalRolledBack: creditAfterFailure.status === "DRAFT" && !creditAfterFailure.approvedAt,
      failedArSettlementRolledBack: Number(originalAfterFailure.outstanding) === 90,
      failedStockReturnRolledBack: returnsAfterFailure.length === 0,
      failedReasonStatusRolledBack: reasonAfterFailure[0]?.status === "PENDING",
      failedJournalRolledBack: journalAfterFailure === null,
      successfulCreditNoteCommitted: committedCredit.glPosted === true,
      successfulArReductionCommitted: Number(committedOriginal.outstanding) === 35,
      successfulStockReturnCommitted: committedReturns.length === 1 && Number(committedReturns[0].totalCost) === 30,
      successfulReasonStatusCommitted: committedReason[0]?.status === "POSTED",
      successfulJournalCommitted: journal.status === "POSTED",
      successfulJournalBalanced: Number(journal.totalDebit) === Number(journal.totalCredit),
      creditNoteJournalLinked: committedCredit.journalId === journal.code,
      stockReturnJournalLinked: committedReturns[0].journalId === journal.code,
      duplicatePostingBlocked: duplicate.alreadyPosted === true && journalCountAfterDuplicate === 1,
      duplicateDidNotDoubleReturnStock: returnCountAfterDuplicate === 1,
      duplicateDidNotDoubleReduceAr: Number(originalAfterDuplicate.outstanding) === 35,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolved = path.resolve(temporaryRoot);
    const root = path.resolve(os.tmpdir());
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
