import { NextResponse } from "next/server";
import { z } from "zod";
import { requireValidatedRequestPermission } from "@/lib/auth";
import { reversePostedJournal } from "@/lib/accounting/journal-reversal";

const schema = z.object({
  journalId: z.string().trim().min(1),
  reversalDate: z.string().trim().min(8),
  reason: z.string().trim().min(5),
});

export async function POST(request: Request) {
  try {
    const actor = await requireValidatedRequestPermission(request, "post.approve");
    const input = schema.parse(await request.json());

    const reversal = await reversePostedJournal({
      journalId: input.journalId,
      reversalDate: input.reversalDate,
      reason: input.reason,
      createdBy: actor.email,
      approvedBy: actor.email,
    });

    return NextResponse.json({
      ok: true,
      source: "prisma",
      authority: "prisma",
      originalJournalId: reversal.originalJournalId,
      originalStatus: reversal.originalStatus,
      reversalJournalId: reversal.reversalJournalId,
      postingDate: reversal.postingDate,
      reason: input.reason,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Journal reversal failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
