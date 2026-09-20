import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { reversePostedJournal } from "@/lib/accounting/journal-reversal";

const schema = z.object({
  journalId: z.string().trim().min(1),
  reversalDate: z.string().trim().min(8),
  reason: z.string().trim().min(5),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) return;
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { secret?: string; payload?: unknown };
    requireSecret(body.secret);
    const input = schema.parse(body.payload || {});

    const reversal = await reversePostedJournal({
      journalId: input.journalId,
      reversalDate: input.reversalDate,
      reason: input.reason,
      createdBy: "journal-reversal-ui",
      approvedBy: "Finance Controller",
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
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
