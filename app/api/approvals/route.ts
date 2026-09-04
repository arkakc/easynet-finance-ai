import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";

const actionSchema = z.object({
  recordType: z.enum(["quote", "purchaseOrder"]),
  recordId: z.string().trim().min(1),
  decision: z.enum(["APPROVE", "CANCEL"]),
  note: z.string().trim().optional().default(""),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function GET() {
  try {
    const [quotes, purchaseOrders] = await Promise.all([
      listTable("Quotes", 500, 0),
      listTable("PurchaseOrders", 500, 0),
    ]);
    return NextResponse.json({
      ok: true,
      quotes: quotes.rows,
      purchaseOrders: purchaseOrders.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Approval queue load failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; payload?: unknown };
    requireSecret(body.secret);
    const input = actionSchema.parse(body.payload || {});

    const table = input.recordType === "quote" ? "Quotes" : "PurchaseOrders";
    const idField = input.recordType === "quote" ? "quoteId" : "poId";
    const result = await findRecords<any>(table, { [idField]: input.recordId }, 1);
    const row = result.rows[0];
    if (!row) throw new Error(`${input.recordType === "quote" ? "Quotation" : "Purchase order"} not found`);

    const current = String(row.status || "DRAFT").toUpperCase();
    if (["CONVERTED", "BILLED", "CANCELLED"].includes(current)) {
      throw new Error(`Cannot change ${input.recordType} in ${current} status`);
    }

    const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "CANCELLED";
    const updated = await updateRecord(
      table,
      idField,
      input.recordId,
      { status: nextStatus },
      `finance-controller:${input.note || input.decision.toLowerCase()}`,
    );

    return NextResponse.json({ ok: true, recordType: input.recordType, recordId: input.recordId, previousStatus: current, status: nextStatus, row: updated.row });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Approval action failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
