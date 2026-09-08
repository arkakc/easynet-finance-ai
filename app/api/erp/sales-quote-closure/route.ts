import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, findRecords, updateRecord } from "@/lib/backend/apps-script";

const schema = z.object({
  quoteId: z.string().trim().min(1),
  remark: z.string().trim().min(8).max(500),
});

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = schema.parse(await request.json());
    const quote = (await findRecords<any>("Quotes", { quoteId: input.quoteId }, 1)).rows[0];
    if (!quote) throw new Error("Sales Quotation not found");
    const status = String(quote.status || "").toUpperCase();
    if (!["APPROVED", "PART_INVOICED"].includes(status)) throw new Error(`Only an open approved quotation can close remaining quantity. Current status: ${status}`);
    const existing = await findRecords<any>("PaymentSchedules", { sourceId: input.quoteId, sourceType: "SALES_QUOTE_REMAINDER_CLOSE" }, 20);
    if ((existing.rows || []).some((row: any) => String(row.status || "").toUpperCase() === "POSTED")) throw new Error("Quotation remainder is already closed");

    const scheduleId = `SQCLOSE-${randomUUID().slice(0, 12).toUpperCase()}`;
    await appendRecord("PaymentSchedules", {
      scheduleId,
      sourceType: "SALES_QUOTE_REMAINDER_CLOSE",
      sourceId: input.quoteId,
      projectId: quote.projectId || "",
      partyId: quote.customerId || "",
      milestone: input.remark,
      dueDate: localDate(),
      percentage: 0,
      amount: 0,
      status: "POSTED",
    }, "sales-quotation:close-remainder");
    await updateRecord("Quotes", "quoteId", input.quoteId, { status: "CLOSED_PARTIAL" }, "sales-quotation:close-remainder");
    return NextResponse.json({ ok: true, quoteId: input.quoteId, status: "CLOSED_PARTIAL", closureId: scheduleId, remark: input.remark });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Sales quotation closure failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
