import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  NormalBalance,
  PaymentStatus,
  PaymentType,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-partial-advance-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { allocateAdvancePartial },
    { findPaymentSchedules },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/advance-allocation"),
    import("../lib/accounting/payment-schedule-store"),
    import("../src/lib/prisma"),
  ]);

  try {
    const ar = await prisma.chartOfAccounts.upsert({
      where: { code: "1130" },
      update: { type: AccountTypeGL.ASSET, normalBalance: NormalBalance.DEBIT, isActive: true },
      create: {
        code: "1130",
        name: "Accounts Receivable",
        type: AccountTypeGL.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isActive: true,
      },
    });
    const advance = await prisma.chartOfAccounts.upsert({
      where: { code: "2150" },
      update: { type: AccountTypeGL.LIABILITY, normalBalance: NormalBalance.CREDIT, isActive: true },
      create: {
        code: "2150",
        name: "Customer Advances / Unearned Revenue",
        type: AccountTypeGL.LIABILITY,
        normalBalance: NormalBalance.CREDIT,
        isActive: true,
      },
    });

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const customer = await prisma.customer.create({
      data: {
        code: `UAT-PADV-CUST-${process.pid}`,
        name: "UAT Partial Advance Customer",
        isActive: true,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        code: `UAT-PADV-INV-${process.pid}`,
        customerId: customer.id,
        issuedDate: new Date("2099-06-01T00:00:00+10:00"),
        subtotal: 100,
        total: 100,
        amountPaid: 0,
        outstanding: 100,
        status: "SENT",
        glPosted: true,
        journalId: `UAT-PADV-INV-JRN-${process.pid}`,
        createdBy: "atomic-partial-advance-uat",
      },
    });
    const payment = await prisma.payment.create({
      data: {
        code: `UAT-PADV-PAY-${process.pid}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-05-28T00:00:00+10:00"),
        amount: 60,
        paymentMethod: "BANK",
        status: PaymentStatus.CLEARED,
        customerId: customer.id,
        journalId: `UAT-PADV-SOURCE-JRN-${process.pid}`,
        createdBy: "atomic-partial-advance-uat",
      },
    });

    await prisma.chartOfAccounts.update({
      where: { id: ar.id },
      data: { isActive: false },
    });

    let failedAllocationRolledBack = false;
    try {
      await allocateAdvancePartial({
        paymentId: payment.id,
        againstDocumentType: "Sales Invoice",
        againstDocumentId: invoice.id,
        amount: 25,
        allocationDate: "2099-06-02",
      });
    } catch (error) {
      failedAllocationRolledBack = /inactive accounts/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!failedAllocationRolledBack) {
      throw new Error("Invalid partial advance allocation did not fail as expected");
    }

    const [invoiceAfterFailure, schedulesAfterFailure, failedJournal] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      findPaymentSchedules("CUSTOMER_ADVANCE_ALLOCATION", payment.id),
      prisma.journalHeader.findFirst({
        where: {
          sourceDocType: "CUSTOMER_ADVANCE_ALLOCATION",
        },
      }),
    ]);

    if (
      !invoiceAfterFailure
      || Number(invoiceAfterFailure.amountPaid) !== 0
      || Number(invoiceAfterFailure.outstanding) !== 100
      || invoiceAfterFailure.status !== "SENT"
    ) {
      throw new Error("Failed partial advance allocation changed AR");
    }
    if (schedulesAfterFailure.length) {
      throw new Error("Failed partial advance allocation left a ledger row");
    }
    if (failedJournal) {
      throw new Error("Failed partial advance allocation left a journal");
    }

    await prisma.chartOfAccounts.update({
      where: { id: ar.id },
      data: { isActive: true },
    });
    await prisma.chartOfAccounts.update({
      where: { id: advance.id },
      data: { isActive: true },
    });

    const first = await allocateAdvancePartial({
      paymentId: payment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: invoice.id,
      amount: 25,
      allocationDate: "2099-06-02",
    });
    const afterFirst = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    const firstSchedules = await findPaymentSchedules("CUSTOMER_ADVANCE_ALLOCATION", payment.id);

    if (
      !afterFirst
      || Number(afterFirst.amountPaid) !== 25
      || Number(afterFirst.outstanding) !== 75
      || afterFirst.status !== "PARTIAL"
    ) {
      throw new Error("First partial advance allocation did not settle AR");
    }
    if (firstSchedules.length !== 1 || Number(firstSchedules[0].amount) !== 25) {
      throw new Error("First partial allocation ledger row was not committed");
    }

    const second = await allocateAdvancePartial({
      paymentId: payment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: invoice.id,
      amount: 15,
      allocationDate: "2099-06-03",
    });
    const [afterSecond, schedulesAfterSecond, journalCount] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      findPaymentSchedules("CUSTOMER_ADVANCE_ALLOCATION", payment.id),
      prisma.journalHeader.count({
        where: { sourceDocType: "CUSTOMER_ADVANCE_ALLOCATION" },
      }),
    ]);

    if (
      !afterSecond
      || Number(afterSecond.amountPaid) !== 40
      || Number(afterSecond.outstanding) !== 60
      || afterSecond.status !== "PARTIAL"
    ) {
      throw new Error("Second partial advance allocation did not settle AR");
    }
    if (schedulesAfterSecond.length !== 2) {
      throw new Error("Multiple partial advance allocations were not preserved");
    }
    if (first.remainingAdvance !== 35 || second.remainingAdvance !== 20) {
      throw new Error("Remaining advance balance is incorrect");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      failedAllocationRolledBack,
      failedSettlementRolledBack: Number(invoiceAfterFailure.outstanding) === 100,
      failedLedgerRowRolledBack: schedulesAfterFailure.length === 0,
      failedJournalRolledBack: failedJournal === null,
      firstPartialAllocationCommitted: Number(afterFirst.outstanding) === 75,
      secondPartialAllocationCommitted: Number(afterSecond.outstanding) === 60,
      multiplePartialAllocationsPreserved: schedulesAfterSecond.length === 2,
      partialAllocationJournalsCommitted: journalCount === 2,
      remainingAdvanceCorrect: second.remainingAdvance === 20,
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
