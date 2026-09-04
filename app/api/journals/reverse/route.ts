import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { batchAppend, findRecords } from "@/lib/backend/apps-script";
import { assertAccountsExist, validateBalancedPosting } from "@/lib/accounting/posting";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

const schema = z.object({
  journalId: z.string().trim().min(1),
  reversalDate: z.string().trim().min(8),
  reason: z.string().trim().min(5),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; payload?: unknown };
    requireSecret(body.secret);
    const input = schema.parse(body.payload || {});

    const originalResult = await findRecords<any>("JournalHeaders", { journalId: input.journalId }, 1);
    const original = originalResult.rows[0];
    if (!original) throw new Error("Original journal not found");
    if (String(original.status).toUpperCase() !== "POSTED") throw new Error("Only POSTED journals can be reversed");
    const prior = await findRecords<any>("JournalHeaders", { reversalOfJournalId: input.journalId }, 10);
    if (prior.rows.length) throw new Error(`Journal has already been reversed by ${prior.rows[0].journalId}`);

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

    const reversalId = `JRN-REV-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    const postingDate = normalizeAccountingDate(input.reversalDate);

    await batchAppend("JournalHeaders", [{
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
    }], "journal-reversal-ui");

    await batchAppend("JournalLines", reversedPostingLines.map((line, index) => ({
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
    })), "journal-reversal-ui");

    return NextResponse.json({ ok: true, originalJournalId: input.journalId, reversalJournalId: reversalId, postingDate, reason: input.reason });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Journal reversal failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
