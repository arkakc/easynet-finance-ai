import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { round2 } from "@/lib/accounting/inventory";
import { isCreditNote } from "@/lib/accounting/sales-return";

const schema = z.object({
  creditNoteId: z.string().trim().min(1),
  paymentDate: z.string().trim().min(8),
  amount: z.coerce.number().finite().positive(),
  paymentMethod: z.string().trim().min(1),
  cashBankAccountId: z.string().trim().min(1),
  reference: z.string().trim().optional().default(""),
});

function year() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextPaymentNumber() {
  const prefix = `PE-${year()}-`;
  const rows = await listTable<any>("Payments", 500, 0);
  const max = (rows.rows || []).reduce((current: number, row: any) => {
    const value = String(row.paymentNumber || "");
    if (!value.startsWith(prefix)) return current;
    const sequence = Number(value.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > current ? sequence : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

async function refundableBalance(creditNote: any) {
  const [journals, lines, payments] = await Promise.all([
    findRecords<any>("JournalHeaders", { documentType: "SALES_CREDIT_NOTE", documentId: creditNote.invoiceId }, 20),
    listTable<any>("JournalLines", 500, 0),
    findRecords<any>("Payments", { sourceDocumentId: creditNote.invoiceId }, 500),
  ]);
  const journalIds = new Set((journals.rows || []).filter((row: any) => String(row.status || "").toUpperCase() === "POSTED").map((row: any) => String(row.journalId || "")));
  const creditCreated = round2((lines.rows || [])
    .filter((line: any) => journalIds.has(String(line.journalId || "")) && String(line.accountId || "") === "ACC-2150")
    .reduce((sum: number, line: any) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
  const refunded = round2((payments.rows || [])
    .filter((row: any) => String(row.partyType || "") === "Customer"
      && String(row.paymentType || "").toUpperCase() === "PAY"
      && String(row.status || "").toUpperCase() === "POSTED"
      && Boolean(row.journalId))
    .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
  return { creditCreated, refunded, refundable: round2(Math.max(0, creditCreated - refunded)) };
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
    if (input.amount > balance.refundable + 0.001) throw new Error(`Refund exceeds refundable customer credit. Available K${balance.refundable.toFixed(2)}`);

    const paymentId = `PAY-${year()}-${randomUUID().slice(0, 8).toUpperCase()}`;
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
