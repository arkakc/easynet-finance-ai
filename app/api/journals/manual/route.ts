import { NextResponse } from "next/server";
import { z } from "zod";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { createPendingManualJournal } from "@/lib/accounting/manual-journal-approval";
import { requireValidatedRequestPermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const lineSchema = z.object({
  accountId: z.string().trim().min(1, "Account is required"),
  debit: z.coerce.number().finite().min(0).optional().default(0),
  credit: z.coerce.number().finite().min(0).optional().default(0),
  description: z.string().trim().max(300).optional().default(""),
});

const entryTypeSchema = z.enum([
  "JOURNAL_ENTRY",
  "INTER_COMPANY_JOURNAL_ENTRY",
  "BANK_ENTRY",
  "CASH_ENTRY",
  "CREDIT_CARD_ENTRY",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "CONTRA_ENTRY",
  "WRITE_OFF_ENTRY",
  "OPENING_ENTRY",
  "DEPRECIATION_ENTRY",
  "EXCHANGE_RATE_REVALUATION",
  "DEFERRED_REVENUE",
  "DEFERRED_EXPENSE",
]);

const journalTypeSchema = z.enum([
  "GENERAL_JOURNAL",
  "SALES_RECEIVABLES_JOURNAL",
  "PURCHASES_PAYABLES_JOURNAL",
  "CASH_DISBURSEMENTS_JOURNAL",
  "CASH_RECEIPTS_JOURNAL",
]);

const schema = z.object({
  entryType: entryTypeSchema.optional().default("JOURNAL_ENTRY"),
  journalType: journalTypeSchema.optional().default("GENERAL_JOURNAL"),
  postingDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Posting date must be YYYY-MM-DD"),
  reference: z.string().trim().min(3, "Reference is required").max(300),
  remarks: z.string().trim().max(500).optional().default(""),
  lines: z.array(lineSchema).min(2, "A journal requires at least two lines"),
});

export async function POST(request: Request) {
  try {
    const user = await requireValidatedRequestPermission(request, "accounts.write");
    const input = schema.parse(await request.json());
    const manualId = documentSeriesId("Manual Journal");
    const nonZeroLines = input.lines
      .map((line) => ({
        accountId: line.accountId,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        description: line.description || input.reference,
      }))
      .filter((line) => line.debit > 0 || line.credit > 0);

    const pending = await createPendingManualJournal({
      entryType: input.entryType,
      journalType: input.journalType,
      postingDate: input.postingDate,
      reference: input.reference,
      remarks: input.remarks,
      lines: nonZeroLines,
      makerEmail: user.email,
      manualId,
    });

    return NextResponse.json({
      ok: true,
      manualId: pending.manualId,
      journalId: pending.journalId,
      status: pending.status,
      entryType: input.entryType,
      journalType: input.journalType,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Manual journal submission failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}


export async function DELETE(request: Request) {
  try {
    const user = await requireValidatedRequestPermission(request, "accounts.write");
    const journalId = String(new URL(request.url).searchParams.get("journalId") || "").trim();
    if (!journalId) throw new Error("Journal ID is required");

    const journal = await prisma.journalHeader.findFirst({
      where: { OR: [{ id: journalId }, { code: journalId }] },
      select: { id: true, code: true, status: true, sourceDocType: true, createdBy: true },
    });
    if (!journal || !String(journal.sourceDocType || "").startsWith("MANUAL_")) throw new Error("Manual journal not found");
    if (!["DRAFT", "PENDING"].includes(journal.status)) throw new Error("Approved/posted journals cannot be deleted");
    const isSystemManager = user.roles.includes("System Manager");
    if (!isSystemManager && journal.createdBy.toLowerCase() !== user.email.toLowerCase()) throw new Error("Only the maker or System Manager can delete this unapproved journal");

    await prisma.journalHeader.delete({ where: { id: journal.id } });
    return NextResponse.json({ ok: true, journalId: journal.code, deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual journal delete failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
