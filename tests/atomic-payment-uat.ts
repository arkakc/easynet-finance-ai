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

  const [{ allocateAdvanceAtomic, finalizePaymentAtomic }, { prisma }] = await Promise.all([
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

    const [canonicalAdvance, canonicalReceivable] = await Promise.all([
      prisma.chartOfAccounts.findUnique({ where: { code: "2150" } }),
      prisma.chartOfAccounts.findUnique({ where: { code: "1130" } }),
    ]);
    if (!canonicalAdvance || !canonicalReceivable) {
      throw new Error("Canonical advance/receivable accounts are missing");
    }
    await Promise.all([
      prisma.chartOfAccounts.update({ where: { id: canonicalAdvance.id }, data: { isActive: true } }),
      prisma.chartOfAccounts.update({ where: { id: canonicalReceivable.id }, data: { isActive: true } }),
    ]);

    const advanceInvoice = await prisma.invoice.create({
      data: {
        code: `UAT-PAY-ADV-INV-${process.pid}`,
        customerId: customer.id,
        issuedDate: new Date("2099-02-10T00:00:00+10:00"),
        subtotal: 60,
        total: 60,
        amountPaid: 0,
        outstanding: 60,
        status: "SENT",
        glPosted: true,
        createdBy: "atomic-payment-uat",
      },
    });

    const advancePayment = await prisma.payment.create({
      data: {
        code: `UAT-PAY-ADV-${process.pid}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-02-09T00:00:00+10:00"),
        amount: 30,
        paymentMethod: "BANK",
        depositAccount: `ACC-${bank.code}`,
        status: PaymentStatus.CLEARED,
        customerId: customer.id,
        journalId: `UAT-ADV-SOURCE-JRN-${process.pid}`,
        createdBy: "atomic-payment-uat",
      },
    });

    // Phase 5 made PaymentAllocation authoritative. The legacy wrapper's caller
    // lines are no longer trusted; force a real canonical posting failure by
    // disabling the AR account used by the allocation engine itself.
    await prisma.chartOfAccounts.update({
      where: { id: canonicalReceivable.id },
      data: { isActive: false },
    });

    let failedAdvanceAllocationRolledBack = false;
    try {
      await allocateAdvanceAtomic({
        paymentId: advancePayment.id,
        againstDocumentType: "Sales Invoice",
        againstDocumentId: advanceInvoice.id,
        postingDate: "2099-02-10",
        documentNumber: advancePayment.code,
        createdBy: "atomic-payment-uat",
        approvedBy: "atomic-payment-uat",
        lines: [
          { accountId: "ACC-2150", debit: 30, customerId: customer.id, description: "Apply customer advance" },
          { accountId: "ACC-1130", credit: 30, customerId: customer.id, description: "Settle receivable" },
        ],
      });
    } catch (error) {
      failedAdvanceAllocationRolledBack = /inactive accounts/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!failedAdvanceAllocationRolledBack) {
      throw new Error("Invalid advance allocation did not fail as expected");
    }

    const [advancePaymentAfterFailure, advanceInvoiceAfterFailure, failedAdvanceAllocationCount, failedAdvanceJournal] = await Promise.all([
      prisma.payment.findUnique({ where: { id: advancePayment.id } }),
      prisma.invoice.findUnique({ where: { id: advanceInvoice.id } }),
      prisma.paymentAllocation.count({
        where: { paymentId: advancePayment.id, invoiceId: advanceInvoice.id, status: "POSTED" },
      }),
      prisma.journalHeader.findFirst({
        where: { sourceDocType: "CUSTOMER_ADVANCE_ALLOCATION" },
      }),
    ]);

    if (!advancePaymentAfterFailure || advancePaymentAfterFailure.invoiceId) {
      throw new Error("Legacy advance payment linkage survived a failed allocation");
    }
    if (
      !advanceInvoiceAfterFailure
      || Number(advanceInvoiceAfterFailure.amountPaid) !== 0
      || Number(advanceInvoiceAfterFailure.outstanding) !== 60
      || advanceInvoiceAfterFailure.status !== "SENT"
    ) {
      throw new Error("Advance allocation AR settlement survived a failed posting");
    }
    if (failedAdvanceAllocationCount !== 0 || failedAdvanceJournal) {
      throw new Error("Advance allocation authority/journal survived a failed posting");
    }

    await prisma.chartOfAccounts.update({
      where: { id: canonicalReceivable.id },
      data: { isActive: true },
    });

    const advanceSuccess = await allocateAdvanceAtomic({
      paymentId: advancePayment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: advanceInvoice.id,
      postingDate: "2099-02-10",
      documentNumber: advancePayment.code,
      createdBy: "atomic-payment-uat",
      approvedBy: "atomic-payment-uat",
      lines: [
        { accountId: "ACC-2150", debit: 30, customerId: customer.id, description: "Apply customer advance" },
        { accountId: "ACC-1130", credit: 30, customerId: customer.id, description: "Settle receivable" },
      ],
    });

    const [allocatedPayment, allocatedInvoice, allocation, advanceJournal] = await Promise.all([
      prisma.payment.findUnique({ where: { id: advancePayment.id } }),
      prisma.invoice.findUnique({ where: { id: advanceInvoice.id } }),
      prisma.paymentAllocation.findUnique({ where: { id: advanceSuccess.allocationId } }),
      prisma.journalHeader.findUnique({ where: { code: advanceSuccess.journalId } }),
    ]);

    if (!allocatedPayment || allocatedPayment.invoiceId !== null) {
      throw new Error("Posted advance retained a deprecated direct invoice link");
    }
    if (
      !allocation
      || allocation.paymentId !== advancePayment.id
      || allocation.invoiceId !== advanceInvoice.id
      || allocation.status !== "POSTED"
      || allocation.journalId !== advanceSuccess.journalId
    ) {
      throw new Error("PaymentAllocation was not committed as the settlement authority");
    }
    if (
      !allocatedInvoice
      || allocatedInvoice.status !== "PARTIAL"
      || Number(allocatedInvoice.amountPaid) !== 30
      || Number(allocatedInvoice.outstanding) !== 30
    ) {
      throw new Error("Advance allocation did not settle AR atomically");
    }
    if (
      !advanceJournal
      || advanceJournal.status !== "POSTED"
      || Number(advanceJournal.totalDebit) !== 30
      || Number(advanceJournal.totalCredit) !== 30
      || advanceJournal.sourceDocId !== allocation.id
    ) {
      throw new Error("Advance allocation journal was not committed correctly");
    }

    const duplicateAdvance = await allocateAdvanceAtomic({
      paymentId: advancePayment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: advanceInvoice.id,
      postingDate: "2099-02-10",
      documentNumber: advancePayment.code,
      lines: [
        { accountId: "ACC-2150", debit: 30 },
        { accountId: "ACC-1130", credit: 30 },
      ],
    });
    const [advanceAllocationCount, advanceJournalCount, advanceInvoiceAfterDuplicate] = await Promise.all([
      prisma.paymentAllocation.count({
        where: { paymentId: advancePayment.id, invoiceId: advanceInvoice.id, status: "POSTED" },
      }),
      prisma.journalHeader.count({
        where: { sourceDocType: "CUSTOMER_ADVANCE_ALLOCATION", sourceDocId: allocation.id },
      }),
      prisma.invoice.findUnique({ where: { id: advanceInvoice.id } }),
    ]);

    if (!duplicateAdvance.alreadyAllocated || advanceAllocationCount !== 1 || advanceJournalCount !== 1) {
      throw new Error("Duplicate advance allocation was not idempotent");
    }
    if (
      !advanceInvoiceAfterDuplicate
      || Number(advanceInvoiceAfterDuplicate.amountPaid) !== 30
      || Number(advanceInvoiceAfterDuplicate.outstanding) !== 30
    ) {
      throw new Error("Duplicate advance allocation double-settled AR");
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
      failedAdvanceAllocationRolledBack,
      failedAdvanceAuthorityRolledBack: failedAdvanceAllocationCount === 0,
      failedAdvanceSettlementRolledBack: Number(advanceInvoiceAfterFailure.outstanding) === 60,
      successfulAdvanceAllocationCommitted: allocation.paymentId === advancePayment.id && allocation.invoiceId === advanceInvoice.id,
      successfulAdvanceSettlementCommitted: Number(allocatedInvoice.outstanding) === 30,
      successfulAdvanceJournalCommitted: advanceJournal.status === "POSTED",
      duplicateAdvanceAllocationBlocked: duplicateAdvance.alreadyAllocated === true && advanceAllocationCount === 1 && advanceJournalCount === 1,
      duplicateAdvanceDidNotDoubleSettle: Number(advanceInvoiceAfterDuplicate.outstanding) === 30,
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
