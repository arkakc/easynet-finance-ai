import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";

const schema = z.object({
  sourceType: z.enum(["QUOTE", "INVOICE", "PROJECT"]),
  sourceId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  partyId: z.string().trim().optional().default(""),
  milestone: z.string().trim().min(2),
  dueDate: z.string().trim().optional().default(""),
  percentage: z.coerce.number().finite().min(0).max(100),
  amount: z.coerce.number().finite().nonnegative(),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function GET() {
  try {
    const result = await listTable("PaymentSchedules", 500, 0);
    return NextResponse.json({ ok: true, schedules: result.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Schedule read failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; record?: unknown };
    requireSecret(body.secret);
    const record = schema.parse(body.record || {});

    if (record.sourceType === "QUOTE") {
      const quote = await findRecords<any>("Quotes", { quoteId: record.sourceId }, 1);
      if (!quote.rows.length) throw new Error("Quotation does not exist");
    } else if (record.sourceType === "INVOICE") {
      const invoice = await findRecords<any>("Invoices", { invoiceId: record.sourceId }, 1);
      if (!invoice.rows.length) throw new Error("Invoice does not exist");
    } else {
      const project = await findRecords<any>("Projects", { projectId: record.sourceId }, 1);
      if (!project.rows.length) throw new Error("Project does not exist");
    }

    const existing = await findRecords<any>("PaymentSchedules", { sourceType: record.sourceType, sourceId: record.sourceId }, 100);
    const totalPercentage = existing.rows.reduce((sum, row) => sum + Number(row.percentage || 0), 0) + record.percentage;
    if (totalPercentage > 100.0001) throw new Error(`Milestone percentages exceed 100% (${totalPercentage.toFixed(2)}%)`);

    const scheduleId = `SCH-${randomUUID().slice(0, 8).toUpperCase()}`;
    const result = await appendRecord("PaymentSchedules", { ...record, scheduleId, status: "PENDING" }, "schedule-ui");
    return NextResponse.json({ ok: true, row: result.row, totalPercentage });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Schedule write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
