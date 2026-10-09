import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { ensurePaymentScheduleInfrastructure } from "@/lib/accounting/payment-schedule-store";
import { POST as recognizeOne } from "@/app/api/accounting/deferred-revenue/route";

type ScheduleRow = {
  scheduleId: string; sourceId: string; milestone: string;
  dueDate: string | null; amount: string | number; status: string;
};
function validDate(value: string) {
  const parsed = new Date(value + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}
async function dueRows(asOf: string) {
  await ensurePaymentScheduleInfrastructure(prisma);
  return prisma.$queryRaw<ScheduleRow[]>(Prisma.sql`
    SELECT "scheduleId", "sourceId", "milestone", "dueDate", "amount", "status"
    FROM "PaymentSchedule"
    WHERE "sourceType" = 'DEFERRED_REVENUE'
      AND "status" = 'PENDING' AND "dueDate" <= ${asOf}
    ORDER BY "dueDate" ASC, "scheduleId" ASC LIMIT 100
  `);
}
export async function GET(request: Request) {
  try {
    await requirePermission("post.approve");
    const asOf = new URL(request.url).searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
    if (!validDate(asOf) || asOf > new Date().toISOString().slice(0, 10)) throw new Error("Invalid as-of date");
    const rows = await dueRows(asOf);
    return NextResponse.json({ ok: true, asOf, schedules: rows.map(row => ({
      scheduleId: row.scheduleId, invoiceId: row.sourceId, dueDate: row.dueDate,
      amount: Number(row.amount), status: row.status, milestone: row.milestone,
    })), cappedAt: 100 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Schedule query failed" }, { status: 400 });
  }
}
export async function POST(request: Request) {
  try {
    await requirePermission("post.approve");
    const input = await request.json() as { asOf?: string; confirm?: boolean };
    const asOf = String(input.asOf || "");
    if (!validDate(asOf) || asOf > new Date().toISOString().slice(0, 10)) throw new Error("Invalid as-of date");
    if (input.confirm !== true) throw new Error("Explicit confirmation required to post recognition journals");
    const rows = (await dueRows(asOf)).slice(0, 25);
    const results: Array<{ scheduleId: string; ok: boolean; journalId?: string; error?: string }> = [];
    for (const row of rows) {
      // Delegate to the same guarded, atomic single-schedule posting path.
      // Failed rows remain pending and do not prevent unrelated schedules posting.
      const response = await recognizeOne(new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: row.scheduleId, action: "recognize", postingDate: asOf }),
      }));
      const result = await response.json() as { ok: boolean; journalId?: string; error?: string };
      results.push({ scheduleId: row.scheduleId, ok: result.ok, journalId: result.journalId, error: result.error });
    }
    return NextResponse.json({ ok: true, asOf, processed: results.length,
      posted: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok).length,
      results, cappedAt: 25 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Batch recognition failed" }, { status: 400 });
  }
}
