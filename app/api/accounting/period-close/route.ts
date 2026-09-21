import { NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/lib/auth";
import { buildPeriodCloseChecklist, closeAccountingPeriod, pngToday, reopenAccountingPeriod } from "@/lib/accounting/period-close";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close"), month: monthSchema, confirmation: z.string() }),
  z.object({ action: z.literal("reopen"), month: monthSchema, confirmation: z.string(), reason: z.string().trim().min(10).max(500) }),
]);

function errorResponse(error: unknown) {
  const message = error instanceof z.ZodError ? error.errors.map((issue) => issue.message).join("; ") : error instanceof Error ? error.message : "Period close action failed";
  const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : /not ready|blocking/i.test(message) ? 409 : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function periodRegister() {
  const rows = await prisma.accountingPeriod.findMany({ orderBy: { startDate: "desc" }, take: 60 });
  return rows.map((row) => ({ ...row, startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10), closedAt: row.closedAt?.toISOString() || null, reopenedAt: row.reopenedAt?.toISOString() || null }));
}

export async function GET(request: Request) {
  try {
    const session = await requirePermission("post.approve");
    const month = new URL(request.url).searchParams.get("month");
    const parsedMonth = month ? monthSchema.parse(month) : null;
    const [periods, lock, checklist] = await Promise.all([
      periodRegister(),
      prisma.globalSettings.findUnique({ where: { key: "posting_lock_date" } }),
      parsedMonth ? buildPeriodCloseChecklist(parsedMonth) : null,
    ]);
    return NextResponse.json({ ok: true, today: pngToday(), canReopen: hasPermission(session, "settings.manage"), postingLockDate: lock?.value || "", periods, checklist });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = actionSchema.parse(await request.json());
    if (body.action === "close") {
      const session = await requirePermission("post.approve");
      if (body.confirmation !== `CLOSE ${body.month}`) throw new Error(`Type CLOSE ${body.month} to confirm`);
      const { period, checklist } = await closeAccountingPeriod(body.month, session.email);
      return NextResponse.json({ ok: true, message: `${period.name} closed; posting locked through ${checklist.periodEnd}`, periodId: period.id, checklist });
    }

    const session = await requirePermission("settings.manage");
    if (body.confirmation !== `REOPEN ${body.month}`) throw new Error(`Type REOPEN ${body.month} to confirm`);
    const reopened = await reopenAccountingPeriod(body.month, session.email, body.reason);
    return NextResponse.json({ ok: true, message: `${reopened.name} reopened with a complete audit trail`, periodId: reopened.id });
  } catch (error) {
    return errorResponse(error);
  }
}
