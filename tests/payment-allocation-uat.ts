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

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-payment-allocation-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { finalizePaymentAtomic },
    { allocateAdvancePaymentAtomic, paymentAllocationSummary },
    { reversePostedJournal },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-payment"),
    import("../lib/accounting/payment-allocation"),
    import("../lib/accounting/journal-reversal"),
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

    await Promise.all([
      account("1110", "UAT Cash", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      account("1130", "UAT Accounts Receivable", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      account("2150", "UAT Customer Advances", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const suffix = String(process.pid);
    const customer = await prisma.customer.create({
      data: {
        code: `UAT-PALLOC-CUST-${suffix}`,
        name: "UAT Payment Allocation Customer",
        isActive: true,
      },
    });

    const invoice1 = await prisma.invoice.create({
      data: {
        code: `UAT-PALLOC-INV1-${suffix}`,
        customerId: customer.id,
        issuedDate: new Date("2099-07-01T00:00:00+10:00"),
        subtotal: 100,
        total: 100,
        amountPaid: 0,
        outstanding: 100,
        status: "SENT",
        glPosted: true,
        journalId: `UAT-PALLOC-INV1-JRN-${suffix}`,
        createdBy: "payment-allocation-uat",
      },
    });

    const invoice2 = await prisma.invoice.create({
      data: {
        code: `UAT-PALLOC-INV2-${suffix}`,
        customerId: customer.id,
        issuedDate: new Date("2099-07-02T00:00:00+10:00"),
        subtotal: 80,
        total: 80,
        amountPaid: 0,
        outstanding: 80,
        status: "SENT",
        glPosted: true,
        journalId: `UAT-PALLOC-INV2-JRN-${suffix}`,
        createdBy: "payment-allocation-uat",
      },
    });

    const directPayment = await prisma.payment.create({
      data: {
        code: `UAT-PALLOC-DIRECT-${suffix}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-07-03T00:00:00+10:00"),
        amount: 40,
        paymentMethod: "Cash",
        status: PaymentStatus.AUTHORIZED,
        customerId: customer.id,
        invoiceId: invoice1.id,
        depositAccount: "ACC-1110",
        createdBy: "payment-allocation-uat",
      },
    });

    const direct = await finalizePaymentAtomic({
      paymentId: directPayment.id,
      postingDate: "2099-07-03",
      amount: 40,
      paymentMethod: "Cash",
      cashBankAccountId: "ACC-1110",
      reference: "UAT direct receipt",
      documentType: "CUSTOMER_RECEIPT",
      documentNumber: directPayment.code,
      againstInvoiceId: invoice1.id,
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
      lines: [
        { accountId: "ACC-1110", debit: 40, customerId: customer.code, description: "Receive cash" },
        { accountId: "ACC-1130", credit: 40, customerId: customer.code, description: "Settle AR" },
      ],
    });

    const [directAllocation, directPaymentAfter, invoice1AfterDirect] = await Promise.all([
      prisma.paymentAllocation.findFirst({
        where: { paymentId: directPayment.id, status: "POSTED" },
      }),
      prisma.payment.findUnique({ where: { id: directPayment.id } }),
      prisma.invoice.findUnique({ where: { id: invoice1.id } }),
    ]);

    if (
      !directAllocation
      || directAllocation.allocationType !== "DIRECT"
      || Number(directAllocation.amount) !== 40
      || directAllocation.journalId !== direct.journalId
    ) throw new Error("Direct PaymentAllocation was not created correctly");
    if (!directPaymentAfter || directPaymentAfter.invoiceId || directPaymentAfter.billId) {
      throw new Error("Legacy Payment invoice/bill linkage was not retired after finalization");
    }
    if (!invoice1AfterDirect || Number(invoice1AfterDirect.outstanding) !== 60) {
      throw new Error("Direct allocation did not settle Sales Invoice");
    }

    const duplicateDirect = await finalizePaymentAtomic({
      paymentId: directPayment.id,
      postingDate: "2099-07-03",
      amount: 40,
      paymentMethod: "Cash",
      cashBankAccountId: "ACC-1110",
      reference: "UAT direct receipt duplicate",
      documentType: "CUSTOMER_RECEIPT",
      documentNumber: directPayment.code,
      againstInvoiceId: invoice1.id,
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
      lines: [
        { accountId: "ACC-1110", debit: 40, customerId: customer.code, description: "Receive cash" },
        { accountId: "ACC-1130", credit: 40, customerId: customer.code, description: "Settle AR" },
      ],
    });
    if (!duplicateDirect.alreadyFinalized) throw new Error("Direct payment finalization is not idempotent");

    const advancePayment = await prisma.payment.create({
      data: {
        code: `UAT-PALLOC-ADV-${suffix}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-07-04T00:00:00+10:00"),
        amount: 60,
        paymentMethod: "Cash",
        status: PaymentStatus.AUTHORIZED,
        customerId: customer.id,
        depositAccount: "ACC-1110",
        createdBy: "payment-allocation-uat",
      },
    });

    const advanceFinal = await finalizePaymentAtomic({
      paymentId: advancePayment.id,
      postingDate: "2099-07-04",
      amount: 60,
      paymentMethod: "Cash",
      cashBankAccountId: "ACC-1110",
      reference: "UAT customer advance",
      documentType: "CUSTOMER_ADVANCE",
      documentNumber: advancePayment.code,
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
      lines: [
        { accountId: "ACC-1110", debit: 60, customerId: customer.code, description: "Receive advance" },
        { accountId: "ACC-2150", credit: 60, customerId: customer.code, description: "Customer advance" },
      ],
    });

    const allocation1 = await allocateAdvancePaymentAtomic({
      paymentId: advancePayment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: invoice1.id,
      amount: 25,
      allocationDate: "2099-07-05",
      idempotencyKey: `UAT-PALLOC-A1-${suffix}`,
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    });

    const allocation1Retry = await allocateAdvancePaymentAtomic({
      paymentId: advancePayment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: invoice1.id,
      amount: 25,
      allocationDate: "2099-07-05",
      idempotencyKey: `UAT-PALLOC-A1-${suffix}`,
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    });
    if (!allocation1Retry.alreadyAllocated) throw new Error("Advance allocation idempotency failed");

    const allocation2 = await allocateAdvancePaymentAtomic({
      paymentId: advancePayment.id,
      againstDocumentType: "Sales Invoice",
      againstDocumentId: invoice2.id,
      amount: 20,
      allocationDate: "2099-07-06",
      idempotencyKey: `UAT-PALLOC-A2-${suffix}`,
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    });

    const summary = await paymentAllocationSummary(advancePayment.id, prisma);
    const [invoice1AfterAdvance, invoice2AfterAdvance] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice1.id } }),
      prisma.invoice.findUnique({ where: { id: invoice2.id } }),
    ]);

    if (summary.allocatedAmount !== 45 || summary.remainingAmount !== 15 || summary.allocations.length !== 2) {
      throw new Error("Many-to-many advance allocation summary is incorrect");
    }
    if (!invoice1AfterAdvance || Number(invoice1AfterAdvance.outstanding) !== 35) {
      throw new Error("First advance allocation did not settle Invoice 1");
    }
    if (!invoice2AfterAdvance || Number(invoice2AfterAdvance.outstanding) !== 60) {
      throw new Error("Second advance allocation did not settle Invoice 2");
    }

    await reversePostedJournal({
      journalId: allocation1.journalId,
      reversalDate: "2099-07-07",
      reason: "UAT reverse first advance allocation",
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    }, prisma);

    const [summaryAfterFirstReversal, invoice1AfterReversal] = await Promise.all([
      paymentAllocationSummary(advancePayment.id, prisma),
      prisma.invoice.findUnique({ where: { id: invoice1.id } }),
    ]);
    if (summaryAfterFirstReversal.allocatedAmount !== 20 || summaryAfterFirstReversal.remainingAmount !== 40) {
      throw new Error("Allocation reversal did not restore advance availability");
    }
    if (!invoice1AfterReversal || Number(invoice1AfterReversal.outstanding) !== 60) {
      throw new Error("Allocation reversal did not reopen Invoice 1");
    }

    let sourceAdvanceReversalBlocked = false;
    try {
      await reversePostedJournal({
        journalId: advanceFinal.journalId,
        reversalDate: "2099-07-08",
        reason: "Should be blocked while allocation remains",
        createdBy: "payment-allocation-uat",
        approvedBy: "Finance Controller",
      }, prisma);
    } catch (error) {
      sourceAdvanceReversalBlocked = /active advance allocation/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!sourceAdvanceReversalBlocked) {
      throw new Error("Advance source payment reversal was not blocked while allocation remained");
    }

    await reversePostedJournal({
      journalId: allocation2.journalId,
      reversalDate: "2099-07-08",
      reason: "UAT reverse second advance allocation",
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    }, prisma);

    const advanceReversal = await reversePostedJournal({
      journalId: advanceFinal.journalId,
      reversalDate: "2099-07-09",
      reason: "UAT reverse unallocated advance source",
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    }, prisma);

    const directReversal = await reversePostedJournal({
      journalId: direct.journalId,
      reversalDate: "2099-07-09",
      reason: "UAT reverse direct receipt",
      createdBy: "payment-allocation-uat",
      approvedBy: "Finance Controller",
    }, prisma);

    const [finalInvoice1, finalInvoice2, finalDirectAllocation, finalAdvancePayment] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice1.id } }),
      prisma.invoice.findUnique({ where: { id: invoice2.id } }),
      prisma.paymentAllocation.findUnique({ where: { id: directAllocation.id } }),
      prisma.payment.findUnique({ where: { id: advancePayment.id } }),
    ]);

    if (!finalInvoice1 || Number(finalInvoice1.outstanding) !== 100) {
      throw new Error("Direct payment reversal did not fully reopen Invoice 1");
    }
    if (!finalInvoice2 || Number(finalInvoice2.outstanding) !== 80) {
      throw new Error("Advance allocation reversal did not fully reopen Invoice 2");
    }
    if (!finalDirectAllocation || finalDirectAllocation.status !== "REVERSED" || !finalDirectAllocation.reversalJournalId) {
      throw new Error("Direct PaymentAllocation reversal trace is incomplete");
    }
    if (!finalAdvancePayment || finalAdvancePayment.status !== "REVERSED") {
      throw new Error("Advance Payment Entry was not reversed after allocations were cleared");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      directAllocationCreated: directAllocation.allocationType === "DIRECT",
      legacyDirectLinkCleared: !directPaymentAfter.invoiceId && !directPaymentAfter.billId,
      directSettlementCommitted: Number(invoice1AfterDirect.outstanding) === 60,
      directFinalizationIdempotent: duplicateDirect.alreadyFinalized === true,
      advanceFinalizedUnallocated: Boolean(advanceFinal.journalId),
      firstAdvanceAllocationCommitted: allocation1.allocatedAmount === 25,
      allocationRequestIdempotent: allocation1Retry.alreadyAllocated === true,
      secondAdvanceAllocationCommitted: allocation2.allocatedAmount === 20,
      manyToManyAllocationPreserved: summary.allocations.length === 2,
      remainingAdvanceCorrect: summary.remainingAmount === 15,
      allocationReversalRestoresAdvance: summaryAfterFirstReversal.remainingAmount === 40,
      allocationReversalRestoresInvoice: Number(invoice1AfterReversal.outstanding) === 60,
      sourceAdvanceReversalBlocked,
      sourceAdvanceReversedAfterDeallocation: Boolean(advanceReversal.reversalJournalId),
      directPaymentReversalReopensInvoice: Number(finalInvoice1.outstanding) === 100,
      directAllocationReversalAuditable: finalDirectAllocation.status === "REVERSED" && Boolean(finalDirectAllocation.reversalJournalId),
      advancePaymentReversalCommitted: finalAdvancePayment.status === "REVERSED",
      directReversalJournalCreated: Boolean(directReversal.reversalJournalId),
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
