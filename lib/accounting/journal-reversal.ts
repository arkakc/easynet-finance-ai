import { Prisma, PrismaClient } from "@prisma/client";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { prisma } from "@/src/lib/prisma";

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const DIRECT_REVERSAL_TYPES = new Set([
  "JOURNAL",
  "JOURNAL_ENTRY",
  "INTER_COMPANY_JOURNAL_ENTRY",
  "BANK_ENTRY",
  "CASH_ENTRY",
  "CREDIT_CARD_ENTRY",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "CONTRA_ENTRY",
  "WRITE_OFF_ENTRY",
  "DEPRECIATION_ENTRY",
  "EXCHANGE_RATE_REVALUATION",
  "DEFERRED_REVENUE",
  "DEFERRED_EXPENSE",
  "SALES_INVOICE",
  "INVOICE",
  "SUPPLIER_BILL",
  "BILL",
  "CUSTOMER_RECEIPT",
  "SUPPLIER_PAYMENT",
  "CUSTOMER_ADVANCE",
  "SUPPLIER_ADVANCE",
  "CUSTOMER_ADVANCE_ALLOCATION",
  "SUPPLIER_ADVANCE_ALLOCATION",
]);

export type ReverseJournalInput = {
  journalId: string;
  reversalDate: string;
  reason: string;
  createdBy?: string;
  approvedBy?: string;
};

function businessDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

function sourceReference(original: { sourceDocId: string | null; reference: string | null }) {
  return String(original.sourceDocId || original.reference || "").trim();
}

function assertDirectReversalType(sourceDocType: string | null) {
  const type = String(sourceDocType || "JOURNAL").trim().toUpperCase() || "JOURNAL";
  if (type === "JOURNAL_REVERSAL") {
    throw new Error("A reversal journal cannot itself be reversed from this workflow");
  }
  if (type.startsWith("MANUAL_")) return type;
  if (!DIRECT_REVERSAL_TYPES.has(type)) {
    throw new Error(
      `${type} requires its dedicated correction workflow; direct GL reversal is blocked to protect the related subledger`,
    );
  }
  return type;
}

async function findInvoice(tx: Prisma.TransactionClient, reference: string) {
  if (!reference) return null;
  return tx.invoice.findFirst({ where: { OR: [{ id: reference }, { code: reference }] } });
}

async function findBill(tx: Prisma.TransactionClient, reference: string) {
  if (!reference) return null;
  return tx.supplierBill.findFirst({ where: { OR: [{ id: reference }, { code: reference }] } });
}

async function findPayment(tx: Prisma.TransactionClient, reference: string) {
  if (!reference) return null;
  return tx.payment.findFirst({ where: { OR: [{ id: reference }, { code: reference }] } });
}

async function reverseAllocationSettlement(
  tx: Prisma.TransactionClient,
  allocation: {
    id: string;
    amount: Prisma.Decimal;
    invoiceId: string | null;
    billId: string | null;
    status: string;
  },
  actor: string,
) {
  if (allocation.status !== "POSTED") {
    throw new Error("Payment allocation is not active");
  }
  const amount = round2(Number(allocation.amount || 0));

  if (allocation.invoiceId) {
    const invoice = await tx.invoice.findUnique({ where: { id: allocation.invoiceId } });
    if (!invoice) throw new Error("Allocated Sales Invoice was not found");
    const amountPaid = round2(Math.max(0, Number(invoice.amountPaid || 0) - amount));
    const outstanding = round2(Math.max(0, Number(invoice.total || 0) - amountPaid));
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid,
        outstanding,
        status: outstanding <= 0.001 ? "PAID" : amountPaid > 0.001 ? "PARTIAL" : "SENT",
      },
    });
  }

  if (allocation.billId) {
    const bill = await tx.supplierBill.findUnique({ where: { id: allocation.billId } });
    if (!bill) throw new Error("Allocated Supplier Invoice was not found");
    const amountPaid = round2(Math.max(0, Number(bill.amountPaid || 0) - amount));
    const outstanding = round2(Math.max(0, Number(bill.total || 0) - amountPaid));
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: {
        amountPaid,
        outstanding,
        status: outstanding <= 0.001 ? "PAID" : amountPaid > 0.001 ? "PARTIAL" : "SENT",
      },
    });
  }

  await tx.paymentAllocation.update({
    where: { id: allocation.id },
    data: {
      status: "REVERSED",
      reversedBy: actor,
      reversedAt: new Date(),
    },
  });
}

async function synchronizeSourceAfterReversal(
  tx: Prisma.TransactionClient,
  original: {
    sourceDocType: string | null;
    sourceDocId: string | null;
    reference: string | null;
  },
  actor: string,
) {
  const type = String(original.sourceDocType || "").toUpperCase();
  const reference = sourceReference(original);

  if (type === "SALES_INVOICE" || type === "INVOICE") {
    const invoice = await findInvoice(tx, reference);
    if (!invoice) {
      throw new Error("Linked Sales Invoice was not found; reversal aborted to protect AR reconciliation");
    }
    const activeAllocations = await tx.paymentAllocation.count({
      where: { invoiceId: invoice.id, status: "POSTED" },
    });
    if (Number(invoice.amountPaid || 0) > 0.001 || activeAllocations > 0) {
      throw new Error("Reverse allocated customer receipts before reversing this sales invoice");
    }
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", outstanding: 0 },
    });
    return;
  }

  if (type === "SUPPLIER_BILL" || type === "BILL") {
    const bill = await findBill(tx, reference);
    if (!bill) {
      throw new Error("Linked Supplier Bill was not found; reversal aborted to protect AP reconciliation");
    }
    const activeAllocations = await tx.paymentAllocation.count({
      where: { billId: bill.id, status: "POSTED" },
    });
    if (Number(bill.amountPaid || 0) > 0.001 || activeAllocations > 0) {
      throw new Error("Reverse allocated supplier payments before reversing this supplier bill");
    }
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: { status: "VOID", outstanding: 0 },
    });
    return;
  }

  if (["CUSTOMER_ADVANCE_ALLOCATION", "SUPPLIER_ADVANCE_ALLOCATION"].includes(type)) {
    const allocation = await tx.paymentAllocation.findFirst({
      where: {
        OR: [
          { id: reference },
          { code: reference },
        ],
      },
    });
    if (!allocation) {
      throw new Error("Linked Payment Allocation was not found");
    }
    if (allocation.allocationType !== "ADVANCE") {
      throw new Error("Only advance allocation journals can be reversed through this allocation workflow");
    }
    await reverseAllocationSettlement(tx, allocation, actor);
    return;
  }

  if (["CUSTOMER_RECEIPT", "SUPPLIER_PAYMENT", "CUSTOMER_ADVANCE", "SUPPLIER_ADVANCE"].includes(type)) {
    const payment = await findPayment(tx, reference);
    if (!payment) {
      throw new Error("Linked Payment Entry was not found; reversal aborted to protect party reconciliation");
    }
    if (payment.status === "REVERSED") throw new Error("The linked Payment Entry is already reversed");

    const allocations = await tx.paymentAllocation.findMany({
      where: {
        paymentId: payment.id,
        status: "POSTED",
      },
      orderBy: { createdAt: "asc" },
    });

    const advanceAllocations = allocations.filter((row) => row.allocationType === "ADVANCE");
    if (advanceAllocations.length) {
      throw new Error(
        "Reverse active advance allocation journal(s) before reversing the original advance Payment Entry",
      );
    }

    for (const allocation of allocations) {
      await reverseAllocationSettlement(tx, allocation, actor);
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REVERSED" },
    });
    return;
  }

}

export async function reversePostedJournal(
  input: ReverseJournalInput,
  client: PrismaClient = prisma,
) {
  const normalizedDate = normalizeAccountingDate(input.reversalDate);
  const postingDate = new Date(`${normalizedDate}T00:00:00+10:00`);

  return client.$transaction(async (tx) => {
    const original = await tx.journalHeader.findFirst({
      where: { OR: [{ id: input.journalId }, { code: input.journalId }] },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!original) throw new Error("Original journal not found");
    if (original.status !== "POSTED") throw new Error("Only POSTED journals can be reversed");

    const type = assertDirectReversalType(original.sourceDocType);
    if (!original.lines.length) throw new Error("Original journal has no lines");
    if (normalizedDate < businessDate(original.date)) {
      throw new Error("Reversal date cannot be earlier than the original posting date");
    }

    const lock = await tx.globalSettings.findUnique({ where: { key: "posting_lock_date" } });
    const lockDate = String(lock?.value || "").trim();
    if (lockDate && /^\d{4}-\d{2}-\d{2}$/.test(lockDate) && normalizedDate <= lockDate) {
      throw new Error(
        `Financial period is locked through ${lockDate}. Reopen the period or use a later reversal date.`,
      );
    }

    const prior = await tx.journalHeader.findFirst({
      where: {
        OR: [
          { reversalOfJournalId: original.id },
          { sourceDocType: "JOURNAL_REVERSAL", sourceDocId: original.id },
          { sourceDocType: "JOURNAL_REVERSAL", sourceDocId: original.code },
        ],
      },
    });
    if (prior) throw new Error(`Journal has already been reversed by ${prior.code}`);

    const reversedLines = original.lines.map((line, index) => ({
      lineNo: index + 1,
      accountId: line.accountId,
      description: `Reversal: ${line.description || original.reference || original.code}`,
      debit: line.credit,
      credit: line.debit,
      amount: line.amount,
      currency: line.currency,
      projectId: line.projectId,
      customerId: line.customerId,
      supplierId: line.supplierId,
      taxCode: line.taxCode,
      taxAmount: line.taxAmount,
      costCenter: line.costCenter,
      sortOrder: line.sortOrder,
    }));
    const totalDebit = round2(reversedLines.reduce((sum, line) => sum + Number(line.debit), 0));
    const totalCredit = round2(reversedLines.reduce((sum, line) => sum + Number(line.credit), 0));
    if (totalDebit !== totalCredit) throw new Error("Original journal is not balanced");

    // Source/subledger correction and the counter-entry commit together.
    // Any failure rolls the complete reversal back.
    await synchronizeSourceAfterReversal(tx, original, input.createdBy || "journal-reversal-ui");

    const reversal = await tx.journalHeader.create({
      data: {
        code: documentSeriesId("Journal Reversal"),
        date: postingDate,
        description: input.reason,
        reference: input.reason,
        sourceDocType: "JOURNAL_REVERSAL",
        sourceDocId: original.id,
        reversalOfJournalId: original.id,
        status: "POSTED",
        currency: original.currency,
        exchangeRate: original.exchangeRate,
        totalDebit,
        totalCredit,
        isBalanced: true,
        createdBy: input.createdBy || "journal-reversal-ui",
        approvedBy: input.approvedBy || "Finance Controller",
        approvedAt: new Date(),
        postedAt: new Date(),
        lines: { create: reversedLines },
      },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });

    if (["CUSTOMER_ADVANCE_ALLOCATION", "SUPPLIER_ADVANCE_ALLOCATION"].includes(type)) {
      const allocationRef = sourceReference(original);
      const allocation = await tx.paymentAllocation.findFirst({
        where: { OR: [{ id: allocationRef }, { code: allocationRef }] },
      });
      if (allocation) {
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: { reversalJournalId: reversal.code },
        });
      }
    }

    if (["CUSTOMER_RECEIPT", "SUPPLIER_PAYMENT", "CUSTOMER_ADVANCE", "SUPPLIER_ADVANCE"].includes(type)) {
      const paymentRef = sourceReference(original);
      const payment = await findPayment(tx, paymentRef);
      if (payment) {
        await tx.paymentAllocation.updateMany({
          where: {
            paymentId: payment.id,
            status: "REVERSED",
            reversalJournalId: null,
          },
          data: { reversalJournalId: reversal.code },
        });
      }
    }

    // The original journal deliberately remains POSTED and immutable.
    // Financial reports therefore see both the original and its POSTED
    // counter-entry, producing the correct net-zero accounting effect.

    return {
      originalJournalId: original.code,
      originalDatabaseId: original.id,
      originalStatus: original.status,
      reversalJournalId: reversal.code,
      reversalDatabaseId: reversal.id,
      postingDate: normalizedDate,
      sourceDocType: type,
      totalDebit,
      totalCredit,
    };
  });
}
