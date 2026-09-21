import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { round2 } from "@/lib/accounting/inventory";
import { isCreditNote } from "@/lib/accounting/sales-return";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";

const schema = z.object({
  creditNoteId: z.string().trim().min(1),
  paymentDate: z.string().trim().min(8),
  amount: z.coerce.number().finite().positive(),
  paymentMethod: z.string().trim().min(1),
  cashBankAccountId: z.string().trim().min(1),
  reference: z.string().trim().optional().default(""),
  exchangeRate: z.coerce.number().finite().positive().optional(),
});

function year() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextPaymentNumber() {
  return documentSeriesId("Payment", Number(year()));
}

async function refundableBalance(creditNote: any) {
  const defaults = await loadConfiguredPostingAccounts();
  const [journals, lines, payments] = await Promise.all([
    findRecords<any>("JournalHeaders", { documentType: "SALES_CREDIT_NOTE", documentId: creditNote.invoiceId }, 20),
    listTable<any>("JournalLines", 500, 0),
    findRecords<any>("Payments", { sourceDocumentId: creditNote.invoiceId }, 500),
  ]);
  const journalIds = new Set(
    (journals.rows || [])
      .filter((row: any) => String(row.status || "").toUpperCase() === "POSTED")
      .map((row: any) => String(row.journalId || "")),
  );
  const transactionCurrency = String(creditNote.currency || "PGK").toUpperCase();
  const creditCreated = round2((lines.rows || [])
    .filter((line: any) =>
      journalIds.has(String(line.journalId || ""))
      && String(line.accountId || "") === defaults.defaultDeferredRevenueAccount,
    )
    .reduce((sum: number, line: any) => {
      const lineCurrency = String(line.transactionCurrency || line.currency || "PGK").toUpperCase();
      if (lineCurrency === transactionCurrency) {
        const credit = Number(line.transactionCredit || 0);
        const debit = Number(line.transactionDebit || 0);
        if (credit || debit) return sum + credit - debit;
      }
      // Legacy PGK journals pre-date explicit transaction-currency fields.
      if (transactionCurrency === "PGK") {
        return sum + Number(line.credit || 0) - Number(line.debit || 0);
      }
      return sum;
    }, 0));
  const refunded = round2((payments.rows || [])
    .filter((row: any) => String(row.partyType || "") === "Customer"
      && String(row.paymentType || "").toUpperCase() === "PAY"
      && String(row.status || "").toUpperCase() === "POSTED"
      && Boolean(row.journalId))
    .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
  return {
    currency: transactionCurrency,
    creditCreated,
    refunded,
    refundable: round2(Math.max(0, creditCreated - refunded)),
  };
}

export async function GET(request: Request) {
  try {
    await requirePermission("sales.read");
    const creditNoteId = new URL(request.url).searchParams.get("creditNoteId")?.trim() || "";
    if (!creditNoteId) throw new Error("Sales Credit Note is required");
    const creditNote = (await findRecords<any>("Invoices", { invoiceId: creditNoteId }, 1)).rows[0];
    if (!creditNote || !isCreditNote(creditNote)) throw new Error("Sales Credit Note not found");
    return NextResponse.json({ ok: true, creditNote, balance: await refundableBalance(creditNote) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer refund balance failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = schema.parse(await request.json());
    const creditNote = (await findRecords<any>("Invoices", { invoiceId: input.creditNoteId }, 1)).rows[0];
    if (!creditNote || !isCreditNote(creditNote)) throw new Error("Sales Credit Note not found");
    if (String(creditNote.status || "").toUpperCase() !== "POSTED" || !String(creditNote.journalId || "").trim()) {
      throw new Error("Sales Credit Note must be posted before a customer refund can be prepared");
    }
    const balance = await refundableBalance(creditNote);
    if (input.amount > balance.refundable + 0.001) {
      throw new Error(
        `Refund exceeds refundable customer credit. Available ${balance.currency} ${balance.refundable.toFixed(2)}`,
      );
    }

    const paymentId = documentSeriesId("Payment", Number(year()));
    const paymentNumber = await nextPaymentNumber();
    const row = await appendRecord("Payments", {
      paymentId,
      paymentNumber,
      paymentType: "PAY",
      partyType: "Customer",
      partyId: creditNote.customerId,
      projectId: creditNote.projectId || "",
      paymentDate: input.paymentDate,
      amount: round2(input.amount),
      currency: String(creditNote.currency || "PGK").toUpperCase(),
      exchangeRate: input.exchangeRate,
      paymentMethod: input.paymentMethod,
      cashBankAccountId: input.cashBankAccountId,
      reference: `CUSTOMER_REFUND|CN:${creditNote.invoiceId}|${input.reference || `Refund against ${creditNote.invoiceNumber}`}`,
      againstDocumentType: "Sales Credit Note",
      againstDocumentId: creditNote.invoiceId,
      sourceDocumentId: creditNote.invoiceId,
      journalId: "",
      status: "DRAFT",
    }, "sales-return:refund-draft");
    return NextResponse.json({ ok: true, payment: row, refundableAfterDraft: round2(balance.refundable - input.amount) });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Customer refund draft failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
