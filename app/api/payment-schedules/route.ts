import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { requirePermission } from "@/lib/auth";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

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
    await requirePermission("sales.read");
    const result = await listTable("PaymentSchedules", 500, 0);
    return NextResponse.json({ ok: true, schedules: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schedule read failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; record?: unknown };
    requireSecret(body.secret);
    const record = schema.parse(body.record || {});

    let sourceTotal = 0;
    if (record.sourceType === "QUOTE") {
      const quote = await findRecords<any>("Quotes", { quoteId: record.sourceId }, 1);
      if (!quote.rows.length) throw new Error("Quotation does not exist");
      sourceTotal = Number(quote.rows[0].totalAmount || 0);
    } else if (record.sourceType === "INVOICE") {
      const invoice = await findRecords<any>("Invoices", { invoiceId: record.sourceId }, 1);
      if (!invoice.rows.length) throw new Error("Invoice does not exist");
      sourceTotal = Number(invoice.rows[0].totalAmount || 0);
    } else {
      const project = await findRecords<any>("Projects", { projectId: record.sourceId }, 1);
      if (!project.rows.length) throw new Error("Project does not exist");
      sourceTotal = Number(project.rows[0].contractTotal || 0);
    }

    const existing = await findRecords<any>("PaymentSchedules", { sourceType: record.sourceType, sourceId: record.sourceId }, 100);
    const totalPercentage = existing.rows.reduce((sum, row) => sum + Number(row.percentage || 0), 0) + record.percentage;
    if (totalPercentage > 100.0001) throw new Error(`Milestone percentages exceed 100% (${totalPercentage.toFixed(2)}%)`);

    const totalScheduledAmount = existing.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) + record.amount;
    if (sourceTotal > 0 && totalScheduledAmount > sourceTotal + 0.02) {
      throw new Error(`Scheduled amount exceeds source total (${sourceTotal.toFixed(2)})`);
    }
    if (sourceTotal > 0 && record.percentage > 0) {
      const expectedAmount = Math.round(sourceTotal * (record.percentage / 100) * 100) / 100;
      if (Math.abs(expectedAmount - record.amount) > 0.02) {
        throw new Error(`Milestone amount ${record.amount.toFixed(2)} does not match ${record.percentage.toFixed(2)}% of source total ${sourceTotal.toFixed(2)} (expected ${expectedAmount.toFixed(2)})`);
      }
    }

    const scheduleId = documentSeriesId("Schedule");
    const dueDate = record.dueDate ? normalizeAccountingDate(record.dueDate) : "";
    const result = await appendRecord("PaymentSchedules", { ...record, dueDate, scheduleId, status: "PENDING" }, "schedule-ui");
    return NextResponse.json({ ok: true, row: result.row, totalPercentage });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Schedule write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
