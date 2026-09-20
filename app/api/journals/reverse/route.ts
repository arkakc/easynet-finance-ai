import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { backendConfigStatus, findRecords, postJournalRecord, updateRecord } from "@/lib/backend/apps-script";
import { assertAccountsExist, validateBalancedPosting } from "@/lib/accounting/posting";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { prisma } from "@/src/lib/prisma";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const schema = z.object({
  journalId: z.string().trim().min(1),
  reversalDate: z.string().trim().min(8),
  reason: z.string().trim().min(5),
});

const n = (value: unknown) => Number(value || 0);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function requireSecret(secret?: string) {
  const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
  if (!env.APP_SECRET && !backendConfigured) return;
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

async function validateSourceCanReverse(original: any) {
  const type = String(original.documentType || "").toUpperCase();

  if (["JOURNAL_REVERSAL", "FUNDING_LOAN", "LOAN_INTEREST_ACCRUAL", "LOAN_REPAYMENT"].includes(type)) {
    throw new Error(`${type} requires a dedicated finance correction workflow and cannot be reversed here`);
  }

  if (type === "SALES_INVOICE") {
    const result = await findRecords<any>("Invoices", { invoiceId: original.documentId }, 1);
    const row = result.rows[0];
    if (row && n(row.paidAmount) > 0.001) {
      throw new Error("Reverse allocated customer receipts before reversing this sales invoice");
    }
  }

  if (type === "SUPPLIER_BILL") {
    const result = await findRecords<any>("SupplierBills", { billId: original.documentId }, 1);
    const row = result.rows[0];
    if (row && n(row.paidAmount) > 0.001) {
      throw new Error("Reverse allocated supplier payments before reversing this supplier bill");
    }
  }
}

async function synchronizeSourceAfterReversal(original: any) {
  const type = String(original.documentType || "").toUpperCase();

  if (type === "SALES_INVOICE") {
    const invoice = await findRecords<any>("Invoices", { invoiceId: original.documentId }, 1);
    if (invoice.rows[0]) {
      await updateRecord(
        "Invoices",
        "invoiceId",
        original.documentId,
        { status: "REVERSED", outstandingAmount: 0 },
        "journal-reversal-ui",
      );
    }
    return;
  }

  if (type === "SUPPLIER_BILL") {
    const bill = await findRecords<any>("SupplierBills", { billId: original.documentId }, 1);
    if (bill.rows[0]) {
      await updateRecord(
        "SupplierBills",
        "billId",
        original.documentId,
        { status: "REVERSED", outstandingAmount: 0 },
        "journal-reversal-ui",
      );
    }
    return;
  }

  if (type === "EXPENSE") {
    const expense = await findRecords<any>("Expenses", { expenseId: original.documentId }, 1);
    if (expense.rows[0]) {
      await updateRecord("Expenses", "expenseId", original.documentId, { status: "REVERSED" }, "journal-reversal-ui");
    }
    return;
  }

  if (type === "CUSTOMER_RECEIPT" || type === "SUPPLIER_PAYMENT") {
    const paymentResult = await findRecords<any>("Payments", { paymentId: original.documentId }, 1);
    const payment = paymentResult.rows[0];
    if (!payment) return;

    const amount = n(payment.amount);
    const againstId = String(payment.againstDocumentId || "");
    if (againstId) {
      if (type === "CUSTOMER_RECEIPT") {
        const invoiceResult = await findRecords<any>("Invoices", { invoiceId: againstId }, 1);
        const invoice = invoiceResult.rows[0];
        if (invoice) {
          const paidAmount = Math.max(0, round2(n(invoice.paidAmount) - amount));
          const outstandingAmount = Math.max(0, round2(n(invoice.totalAmount) - paidAmount));
          await updateRecord(
            "Invoices",
            "invoiceId",
            againstId,
            { paidAmount, outstandingAmount, status: "POSTED" },
            "journal-reversal-ui",
          );
        }
      } else {
        const billResult = await findRecords<any>("SupplierBills", { billId: againstId }, 1);
        const bill = billResult.rows[0];
        if (bill) {
          const paidAmount = Math.max(0, round2(n(bill.paidAmount) - amount));
          const outstandingAmount = Math.max(0, round2(n(bill.totalAmount) - paidAmount));
          await updateRecord(
            "SupplierBills",
            "billId",
            againstId,
            { paidAmount, outstandingAmount, status: "POSTED" },
            "journal-reversal-ui",
          );
        }
      }
    }

    await updateRecord("Payments", "paymentId", original.documentId, { status: "REVERSED" }, "journal-reversal-ui");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { secret?: string; payload?: unknown };
    requireSecret(body.secret);
    const input = schema.parse(body.payload || {});
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      const original = await prisma.journalHeader.findFirst({
        where: { OR: [{ id: input.journalId }, { code: input.journalId }] },
        include: { lines: true },
      });
      if (!original) throw new Error("Original journal not found");
      if (original.status !== "POSTED") throw new Error("Only POSTED journals can be reversed");
      const prior = await prisma.journalHeader.findFirst({ where: { reversalOfJournalId: original.id } });
      if (prior) throw new Error(`Journal has already been reversed by ${prior.code}`);
      const type = String(original.sourceDocType || "").toUpperCase();
      if (["JOURNAL_REVERSAL", "FUNDING_LOAN", "LOAN_INTEREST_ACCRUAL", "LOAN_REPAYMENT"].includes(type)) {
        throw new Error(`${type} requires a dedicated finance correction workflow and cannot be reversed here`);
      }
      if (!original.lines.length) throw new Error("Original journal has no lines");
      const reversalId = documentSeriesId("Journal Reversal");
      const postingDate = new Date(normalizeAccountingDate(input.reversalDate));
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
        sortOrder: line.sortOrder,
      }));
      const totalDebit = reversedLines.reduce((sum, line) => sum + Number(line.debit), 0);
      const totalCredit = reversedLines.reduce((sum, line) => sum + Number(line.credit), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) throw new Error("Original journal is not balanced");
      const reversal = await prisma.$transaction(async (tx) => {
        const created = await tx.journalHeader.create({
          data: {
            code: reversalId,
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
            createdBy: "journal-reversal-ui",
            approvedBy: "Finance Controller",
            approvedAt: new Date(),
            postedAt: new Date(),
            lines: { create: reversedLines },
          },
        });
        await tx.journalHeader.update({ where: { id: original.id }, data: { status: "REVERSED" } });
        return created;
      });
      return NextResponse.json({
        ok: true,
        source: "prisma",
        originalJournalId: original.code,
        reversalJournalId: reversal.code,
        postingDate: normalizeAccountingDate(input.reversalDate),
        reason: input.reason,
      });
    }

    const originalResult = await findRecords<any>("JournalHeaders", { journalId: input.journalId }, 1);
    const original = originalResult.rows[0];
    if (!original) throw new Error("Original journal not found");
    if (String(original.status).toUpperCase() !== "POSTED") throw new Error("Only POSTED journals can be reversed");

    const prior = await findRecords<any>("JournalHeaders", { reversalOfJournalId: input.journalId }, 10);
    if (prior.rows.length) throw new Error(`Journal has already been reversed by ${prior.rows[0].journalId}`);

    await validateSourceCanReverse(original);

    const originalLines = await findRecords<any>("JournalLines", { journalId: input.journalId }, 500);
    if (!originalLines.rows.length) throw new Error("Original journal has no lines");

    const reversedPostingLines = originalLines.rows.map((line: any) => ({
      accountId: line.accountId,
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      customerId: line.customerId || "",
      supplierId: line.supplierId || "",
      projectId: line.projectId || original.projectId || "",
      taxCode: line.taxCode || "",
      description: `Reversal: ${line.description || original.reference || input.journalId}`,
    }));
    validateBalancedPosting(reversedPostingLines);
    await assertAccountsExist(reversedPostingLines);

    const reversalId = documentSeriesId("Journal Reversal");
    const now = new Date().toISOString();
    const postingDate = normalizeAccountingDate(input.reversalDate);

    const reversalLines = reversedPostingLines.map((line, index) => ({
      journalLineId: `${reversalId}-${String(index + 1).padStart(3, "0")}`,
      journalId: reversalId,
      lineNo: index + 1,
      accountId: line.accountId,
      customerId: line.customerId,
      supplierId: line.supplierId,
      projectId: line.projectId,
      debit: line.debit,
      credit: line.credit,
      taxCode: line.taxCode,
      description: line.description,
      createdAt: now,
    }));

    await postJournalRecord({
      header: {
        journalId: reversalId,
        postingDate,
        documentType: "JOURNAL_REVERSAL",
        documentId: input.journalId,
        documentNumber: reversalId,
        reference: input.reason,
        projectId: original.projectId || "",
        status: "POSTED",
        reversalOfJournalId: input.journalId,
        createdBy: "journal-reversal-ui",
        approvedBy: "Finance Controller",
        createdAt: now,
        postedAt: now,
      },
      lines: reversalLines,
      actor: "journal-reversal-ui",
    });

    await synchronizeSourceAfterReversal(original);

    return NextResponse.json({
      ok: true,
      originalJournalId: input.journalId,
      reversalJournalId: reversalId,
      postingDate,
      reason: input.reason,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Journal reversal failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
