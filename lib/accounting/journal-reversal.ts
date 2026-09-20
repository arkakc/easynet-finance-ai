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

async function synchronizeSourceAfterReversal(
  tx: Prisma.TransactionClient,
  original: {
    sourceDocType: string | null;
    sourceDocId: string | null;
    reference: string | null;
  },
) {
  const type = String(original.sourceDocType || "").toUpperCase();
  const reference = sourceReference(original);

  if (type === "SALES_INVOICE" || type === "INVOICE") {
    const invoice = await findInvoice(tx, reference);
    if (!invoice) {
      throw new Error("Linked Sales Invoice was not found; reversal aborted to protect AR reconciliation");
    }
    const activePayments = await tx.payment.count({
      where: {
        invoiceId: invoice.id,
        status: { notIn: ["REVERSED", "FAILED", "CANCELLED"] },
      },
    });
    if (Number(invoice.amountPaid || 0) > 0.001 || activePayments > 0) {
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
    const activePayments = await tx.payment.count({
      where: {
        billId: bill.id,
        status: { notIn: ["REVERSED", "FAILED", "CANCELLED"] },
      },
    });
    if (Number(bill.amountPaid || 0) > 0.001 || activePayments > 0) {
      throw new Error("Reverse allocated supplier payments before reversing this supplier bill");
    }
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: { status: "VOID", outstanding: 0 },
    });
    return;
  }

  if (["CUSTOMER_RECEIPT", "SUPPLIER_PAYMENT", "CUSTOMER_ADVANCE", "SUPPLIER_ADVANCE"].includes(type)) {
    const payment = await findPayment(tx, reference);
    if (!payment) {
      throw new Error("Linked Payment Entry was not found; reversal aborted to protect party reconciliation");
    }
    if (payment.status === "REVERSED") throw new Error("The linked Payment Entry is already reversed");

    if (type === "CUSTOMER_RECEIPT" && payment.invoiceId) {
      const invoice = await tx.invoice.findUnique({ where: { id: payment.invoiceId } });
      if (!invoice) throw new Error("Allocated Sales Invoice was not found");
      const settlement = round2(Number(payment.amount || 0) + Number(payment.s65aDeduction || 0));
      const amountPaid = Math.max(0, round2(Number(invoice.amountPaid || 0) - settlement));
      const outstanding = Math.max(0, round2(Number(invoice.total || 0) - amountPaid));
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid,
          outstanding,
          status: outstanding <= 0.01 ? "PAID" : amountPaid > 0.01 ? "PARTIAL" : "SENT",
        },
      });
    }

    if (type === "SUPPLIER_PAYMENT" && payment.billId) {
      const bill = await tx.supplierBill.findUnique({ where: { id: payment.billId } });
      if (!bill) throw new Error("Allocated Supplier Bill was not found");
      const settlement = round2(
        Number(payment.amount || 0)
        + Number(payment.bptDeduction || 0)
        + Number(payment.withholdingTax || 0),
      );
      const amountPaid = Math.max(0, round2(Number(bill.amountPaid || 0) - settlement));
      const outstanding = Math.max(0, round2(Number(bill.total || 0) - amountPaid));
      await tx.supplierBill.update({
        where: { id: bill.id },
        data: {
          amountPaid,
          outstanding,
          status: outstanding <= 0.01 ? "PAID" : amountPaid > 0.01 ? "PARTIAL" : "SENT",
        },
      });
    }

    await tx.payment.update({ where: { id: payment.id }, data: { status: "REVERSED" } });
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
    await synchronizeSourceAfterReversal(tx, original);

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
