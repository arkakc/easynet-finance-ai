import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountTypeGL, NormalBalance, PaymentStatus, PaymentType } from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-payment-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);

  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [{ finalizePaymentAtomic }, { prisma }] = await Promise.all([
    import("../lib/accounting/atomic-payment"),
    import("../src/lib/prisma"),
  ]);

  try {
    const bank = await prisma.chartOfAccounts.upsert({
      where: { code: "UAT-PAY-BANK" },
      update: { type: AccountTypeGL.ASSET, normalBalance: NormalBalance.DEBIT, parentId: null, isActive: true },
      create: {
        code: "UAT-PAY-BANK",
        name: "UAT Payment Bank",
        type: AccountTypeGL.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isActive: true,
      },
    });
    const receivable = await prisma.chartOfAccounts.upsert({
      where: { code: "UAT-PAY-AR" },
      update: { type: AccountTypeGL.ASSET, normalBalance: NormalBalance.DEBIT, parentId: null, isActive: true },
      create: {
        code: "UAT-PAY-AR",
        name: "UAT Payment Receivable",
        type: AccountTypeGL.ASSET,
        normalBalance: NormalBalance.DEBIT,
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
        code: `UAT-PAY-CUST-${process.pid}`,
        name: "UAT Atomic Payment Customer",
        isActive: true,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        code: `UAT-PAY-INV-${process.pid}`,
        customerId: customer.id,
        issuedDate: new Date("2099-02-01T00:00:00+10:00"),
        subtotal: 100,
        total: 100,
        amountPaid: 0,
        outstanding: 100,
        status: "SENT",
        glPosted: true,
        createdBy: "atomic-payment-uat",
      },
    });
    const payment = await prisma.payment.create({
      data: {
        code: `UAT-PAY-REC-${process.pid}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-02-02T00:00:00+10:00"),
        amount: 25,
        paymentMethod: "BANK",
        depositAccount: `ACC-${bank.code}`,
        status: PaymentStatus.AUTHORIZED,
        customerId: customer.id,
        invoiceId: invoice.id,
        createdBy: "atomic-payment-uat",
      },
    });

    let failedPostingRolledBack = false;
    try {
      await finalizePaymentAtomic({
        paymentId: payment.id,
        postingDate: "2099-02-02",
        amount: 25,
        paymentMethod: "BANK",
        cashBankAccountId: `ACC-${bank.code}`,
        reference: "UAT invalid account forces rollback",
        documentType: "CUSTOMER_RECEIPT",
        documentNumber: payment.code,
        againstInvoiceId: invoice.id,
        createdBy: "atomic-payment-uat",
        approvedBy: "atomic-payment-uat",
        lines: [
          { accountId: `ACC-${bank.code}`, debit: 25, customerId: customer.id, description: "Bank receipt" },
          { accountId: "ACC-UAT-MISSING-ACCOUNT", credit: 25, customerId: customer.id, description: "Receivable settlement" },
        ],
      });
    } catch (error) {
      failedPostingRolledBack = /missing accounts/i.test(error instanceof Error ? error.message : String(error));
    }
    if (!failedPostingRolledBack) throw new Error("Invalid payment posting did not fail as expected");

    const [paymentAfterFailure, invoiceAfterFailure, failedJournal] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      prisma.journalHeader.findFirst({ where: { sourceDocType: "CUSTOMER_RECEIPT", sourceDocId: payment.id } }),
    ]);
    if (!paymentAfterFailure || paymentAfterFailure.status !== PaymentStatus.AUTHORIZED || paymentAfterFailure.journalId) {
      throw new Error("Payment state survived a failed atomic posting");
    }
    if (
      !invoiceAfterFailure
      || invoiceAfterFailure.status !== "SENT"
      || Number(invoiceAfterFailure.amountPaid) !== 0
      || Number(invoiceAfterFailure.outstanding) !== 100
    ) {
      throw new Error("AR settlement survived a failed atomic posting");
    }
    if (failedJournal) throw new Error("Journal survived a failed atomic payment posting");

    const success = await finalizePaymentAtomic({
      paymentId: payment.id,
      postingDate: "2099-02-02",
      amount: 25,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bank.code}`,
      reference: "UAT customer receipt",
      documentType: "CUSTOMER_RECEIPT",
      documentNumber: payment.code,
      againstInvoiceId: invoice.id,
      createdBy: "atomic-payment-uat",
      approvedBy: "atomic-payment-uat",
      lines: [
        { accountId: `ACC-${bank.code}`, debit: 25, customerId: customer.id, description: "Bank receipt" },
        { accountId: `ACC-${receivable.code}`, credit: 25, customerId: customer.id, description: "Receivable settlement" },
      ],
    });

    const [committedPayment, committedInvoice, committedJournal] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      prisma.journalHeader.findUnique({ where: { code: success.journalId }, include: { lines: true } }),
    ]);

    if (!committedPayment || committedPayment.status !== PaymentStatus.CLEARED || committedPayment.journalId !== success.journalId) {
      throw new Error("Payment was not committed with its journal");
    }
    if (
      !committedInvoice
      || committedInvoice.status !== "PARTIAL"
      || Number(committedInvoice.amountPaid) !== 25
      || Number(committedInvoice.outstanding) !== 75
    ) {
      throw new Error("AR settlement was not committed atomically");
    }
    if (
      !committedJournal
      || committedJournal.status !== "POSTED"
      || Number(committedJournal.totalDebit) !== 25
      || Number(committedJournal.totalCredit) !== 25
      || committedJournal.lines.length !== 2
    ) {
      throw new Error("Payment journal was not committed correctly");
    }

    const duplicate = await finalizePaymentAtomic({
      paymentId: payment.id,
      postingDate: "2099-02-02",
      amount: 25,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bank.code}`,
      reference: "UAT duplicate attempt",
      documentType: "CUSTOMER_RECEIPT",
      documentNumber: payment.code,
      againstInvoiceId: invoice.id,
      lines: [
        { accountId: `ACC-${bank.code}`, debit: 25 },
        { accountId: `ACC-${receivable.code}`, credit: 25 },
      ],
    });
    const journalCount = await prisma.journalHeader.count({
      where: { sourceDocType: "CUSTOMER_RECEIPT", sourceDocId: payment.id },
    });
    const invoiceAfterDuplicate = await prisma.invoice.findUnique({ where: { id: invoice.id } });

    if (!duplicate.alreadyFinalized) throw new Error("Duplicate payment finalization was not treated idempotently");
    if (journalCount !== 1) throw new Error("Duplicate payment finalization created another journal");
    if (!invoiceAfterDuplicate || Number(invoiceAfterDuplicate.amountPaid) !== 25 || Number(invoiceAfterDuplicate.outstanding) !== 75) {
      throw new Error("Duplicate payment finalization changed AR settlement");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      failedPostingRolledBack,
      failedPaymentStateRolledBack: paymentAfterFailure.status === PaymentStatus.AUTHORIZED && !paymentAfterFailure.journalId,
      failedArSettlementRolledBack: invoiceAfterFailure.status === "SENT" && Number(invoiceAfterFailure.outstanding) === 100,
      failedJournalRolledBack: failedJournal === null,
      successfulPaymentCommitted: committedPayment.status === PaymentStatus.CLEARED,
      successfulArSettlementCommitted: committedInvoice.status === "PARTIAL" && Number(committedInvoice.outstanding) === 75,
      successfulJournalCommitted: committedJournal.status === "POSTED",
      paymentJournalLinked: committedPayment.journalId === committedJournal.code,
      duplicateFinalizationBlocked: duplicate.alreadyFinalized === true && journalCount === 1,
      duplicateDidNotDoubleSettle: Number(invoiceAfterDuplicate.outstanding) === 75,
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
