import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountTypeGL, MovementType, NormalBalance } from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-sales-invoice-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);

  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { finalizeSalesInvoiceAtomic },
    { findPaymentSchedules },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-sales-invoice"),
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
      update: { name, type, normalBalance, parentId: null, isActive: true },
      create: { code, name, type, normalBalance, isActive: true },
    });

    const [ar, revenue, deferred, cogs, inventory] = await Promise.all([
      account("UAT-SI-AR", "UAT Sales Invoice Receivable", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      account("UAT-SI-REV", "UAT Sales Invoice Revenue", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
      account("UAT-SI-DEF", "UAT Sales Invoice Deferred Revenue", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      account("UAT-SI-COGS", "UAT Sales Invoice COGS", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
      account("UAT-SI-INV", "UAT Sales Invoice Inventory", AccountTypeGL.ASSET, NormalBalance.DEBIT),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const customer = await prisma.customer.create({
      data: {
        code: `UAT-SI-CUST-${process.pid}`,
        name: "UAT Atomic Sales Customer",
        isActive: true,
      },
    });

    const item = await prisma.item.create({
      data: {
        code: `UAT-SI-ITEM-${process.pid}`,
        name: "UAT Atomic Stock Item",
        type: "GOOD",
        unit: "PCS",
        trackQty: true,
        purchasePrice: 20,
        sellPrice: 30,
        costAccount: `ACC-${cogs.code}`,
        revenueAccount: `ACC-${revenue.code}`,
        inventoryAsset: `ACC-${inventory.code}`,
        isActive: true,
      },
    });

    await prisma.stockMovement.create({
      data: {
        id: `UAT-SI-OPENING-${process.pid}`,
        itemId: item.id,
        type: MovementType.PURCHASE_RECEIPT,
        quantity: 10,
        unitCost: 20,
        totalCost: 200,
        referenceType: "UAT_OPENING",
        referenceId: `UAT-SI-OPENING-${process.pid}`,
        createdAt: new Date("2099-02-01T00:00:00+10:00"),
        createdBy: "atomic-sales-invoice-uat",
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        code: `UAT-SI-INV-${process.pid}`,
        customerId: customer.id,
        issuedDate: new Date("2099-02-10T00:00:00+10:00"),
        subtotal: 100,
        total: 100,
        amountPaid: 0,
        outstanding: 100,
        status: "SENT",
        glPosted: false,
        createdBy: "atomic-sales-invoice-uat",
      },
    });

    const scheduleId = `REV-${invoice.id}-002-001`;
    const common = {
      invoiceId: invoice.id,
      postingDate: "2099-02-10",
      documentNumber: invoice.code,
      reference: "Atomic Sales Invoice UAT",
      customerId: customer.code,
      projectId: "",
      sourceDocumentId: "",
      total: 100,
      gst: 0,
      revenueLines: [
        { accountId: `ACC-${revenue.code}`, amount: 60, description: "Immediate revenue", deferred: false },
        { accountId: `ACC-${revenue.code}`, amount: 40, description: "Deferred service revenue", deferred: true },
      ],
      stockLines: [
        {
          itemId: item.id,
          quantity: 2,
          costAccountId: `ACC-${cogs.code}`,
          fallbackRate: 20,
          description: "UAT cost of goods sold",
        },
      ],
      receivableAccountId: `ACC-${ar.code}`,
      deferredRevenueAccountId: `ACC-${deferred.code}`,
      deferredSchedules: [
        {
          scheduleId,
          sourceType: "DEFERRED_REVENUE",
          sourceId: invoice.id,
          partyId: customer.code,
          milestone: `service-line|${revenue.code}|1/1`,
          dueDate: "2099-02-28",
          percentage: 100,
          amount: 40,
          status: "PENDING",
        },
      ],
      createdBy: "atomic-sales-invoice-uat",
      approvedBy: "atomic-sales-invoice-uat",
    };

    let failedPostingRolledBack = false;
    try {
      await finalizeSalesInvoiceAtomic({
        ...common,
        inventoryAccountId: "ACC-UAT-SI-MISSING-INVENTORY",
      });
    } catch (error) {
      failedPostingRolledBack = /missing accounts/i.test(error instanceof Error ? error.message : String(error));
    }
    if (!failedPostingRolledBack) throw new Error("Invalid Sales Invoice posting did not fail as expected");

    const [invoiceAfterFailure, stockAfterFailure, journalAfterFailure, schedulesAfterFailure] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      prisma.stockMovement.findMany({ where: { referenceId: invoice.id, type: MovementType.SALES_ISSUE } }),
      prisma.journalHeader.findFirst({ where: { sourceDocType: "SALES_INVOICE", sourceDocId: invoice.id } }),
      findPaymentSchedules("DEFERRED_REVENUE", invoice.id),
    ]);

    if (!invoiceAfterFailure || invoiceAfterFailure.status !== "SENT" || invoiceAfterFailure.glPosted || invoiceAfterFailure.journalId) {
      throw new Error("Sales Invoice state survived a failed atomic posting");
    }
    if (stockAfterFailure.length) throw new Error("Stock issue survived a failed atomic Sales Invoice posting");
    if (journalAfterFailure) throw new Error("Journal survived a failed atomic Sales Invoice posting");
    if (schedulesAfterFailure.length) throw new Error("Deferred schedule survived a failed atomic Sales Invoice posting");

    const success = await finalizeSalesInvoiceAtomic({
      ...common,
      inventoryAccountId: `ACC-${inventory.code}`,
    });

    const [committedInvoice, issues, journal, schedules] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      prisma.stockMovement.findMany({ where: { referenceId: invoice.id, type: MovementType.SALES_ISSUE } }),
      prisma.journalHeader.findUnique({ where: { code: success.journalId }, include: { lines: true } }),
      findPaymentSchedules("DEFERRED_REVENUE", invoice.id),
    ]);

    if (!committedInvoice || !committedInvoice.glPosted || committedInvoice.journalId !== success.journalId) {
      throw new Error("Sales Invoice did not commit with its journal");
    }
    if (issues.length !== 1 || Number(issues[0].quantity) !== 2 || Number(issues[0].totalCost) !== 40 || issues[0].journalId !== success.journalId) {
      throw new Error("Sales Invoice stock issue did not commit atomically at moving-average cost");
    }
    if (
      !journal
      || journal.status !== "POSTED"
      || Number(journal.totalDebit) !== 140
      || Number(journal.totalCredit) !== 140
      || journal.lines.length !== 5
    ) {
      throw new Error("Sales Invoice journal was not committed correctly");
    }
    if (schedules.length !== 1 || schedules[0].scheduleId !== scheduleId || schedules[0].amount !== 40) {
      throw new Error("Deferred revenue schedule was not committed with the Sales Invoice");
    }

    const duplicate = await finalizeSalesInvoiceAtomic({
      ...common,
      inventoryAccountId: `ACC-${inventory.code}`,
    });
    const [issueCountAfterDuplicate, journalCountAfterDuplicate, schedulesAfterDuplicate] = await Promise.all([
      prisma.stockMovement.count({ where: { referenceId: invoice.id, type: MovementType.SALES_ISSUE } }),
      prisma.journalHeader.count({ where: { sourceDocType: "SALES_INVOICE", sourceDocId: invoice.id } }),
      findPaymentSchedules("DEFERRED_REVENUE", invoice.id),
    ]);

    if (!duplicate.alreadyPosted) throw new Error("Duplicate Sales Invoice posting was not idempotent");
    if (issueCountAfterDuplicate !== 1) throw new Error("Duplicate Sales Invoice posting created another stock issue");
    if (journalCountAfterDuplicate !== 1) throw new Error("Duplicate Sales Invoice posting created another journal");
    if (schedulesAfterDuplicate.length !== 1) throw new Error("Duplicate Sales Invoice posting created another deferred schedule");

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      failedPostingRolledBack,
      failedInvoiceStateRolledBack: invoiceAfterFailure.status === "SENT" && !invoiceAfterFailure.glPosted,
      failedStockIssueRolledBack: stockAfterFailure.length === 0,
      failedDeferredScheduleRolledBack: schedulesAfterFailure.length === 0,
      failedJournalRolledBack: journalAfterFailure === null,
      successfulInvoiceCommitted: committedInvoice.glPosted === true,
      successfulStockIssueCommitted: issues.length === 1 && Number(issues[0].totalCost) === 40,
      successfulDeferredScheduleCommitted: schedules.length === 1,
      successfulJournalCommitted: journal.status === "POSTED",
      successfulJournalBalanced: Number(journal.totalDebit) === Number(journal.totalCredit),
      stockMovementJournalLinked: issues[0].journalId === journal.code,
      invoiceJournalLinked: committedInvoice.journalId === journal.code,
      duplicatePostingBlocked: duplicate.alreadyPosted === true && journalCountAfterDuplicate === 1,
      duplicateDidNotDoubleIssueStock: issueCountAfterDuplicate === 1,
      duplicateDidNotDuplicateSchedule: schedulesAfterDuplicate.length === 1,
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
