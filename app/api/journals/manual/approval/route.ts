import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRequestPermission } from "@/lib/auth";
import {
  approvePendingManualJournal,
  rejectPendingManualJournal,
} from "@/lib/accounting/manual-journal-approval";

const schema = z.object({
  journalId: z.string().trim().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const checker = requireRequestPermission(request, "post.approve");
    const input = schema.parse(await request.json());

    const result = input.decision === "APPROVE"
      ? await approvePendingManualJournal({
          journalId: input.journalId,
          checkerEmail: checker.email,
          note: input.note,
        })
      : await rejectPendingManualJournal({
          journalId: input.journalId,
          checkerEmail: checker.email,
          note: input.note,
        });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Manual journal approval action failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
