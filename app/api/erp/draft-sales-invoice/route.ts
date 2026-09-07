import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { batchAppend, findRecords, updateRecord } from "@/lib/backend/apps-script";
import { resolveTransactionItems } from "@/lib/erp/item-linking";
import { round2 } from "@/lib/accounting/inventory";

const lineSchema = z.object({
  invoiceLineId: z.string().trim().optional().default(""),
  itemId: z.string().trim().min(1),
  itemCode: z.string().trim().optional().default(""),
  itemName: z.string().trim().min(1),
  itemType: z.string().trim().optional().default("STOCK"),
  description: z.string().trim().optional().default(""),
  qty: z.coerce.number().finite().positive(),
  uom: z.string().trim().min(1).default("Each"),
  rate: z.coerce.number().finite().nonnegative(),
});

const inputSchema = z.object({
  invoiceId: z.string().trim().min(1),
  invoiceDate: z.string().trim().min(8),
  dueDate: z.string().trim().optional().default(""),
  gstRate: z.coerce.number().finite().min(0).max(1),
  lines: z.array(lineSchema).min(1),
});

function activeLineId(invoiceId: string, requested: string) {
  const value = String(requested || "").trim();
  if (value) return value;
  return `${invoiceId}-EDIT-${randomUUID().slice(0, 12).toUpperCase()}`;
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = inputSchema.parse(await request.json());

    const invoice = (await findRecords<any>("Invoices", { invoiceId: input.invoiceId }, 1)).rows[0];
    if (!invoice) throw new Error("Sales Invoice not found");
    if (String(invoice.status || "DRAFT").toUpperCase() !== "DRAFT") {
      throw new Error("Only DRAFT Sales Invoices can be edited");
    }
    if (String(invoice.journalId || "").trim()) throw new Error("Posted Sales Invoice cannot be edited");
    if (Number(invoice.paidAmount || 0) > 0.0001) throw new Error("Sales Invoice with payment activity cannot be edited as draft");

    const resolved = await resolveTransactionItems(input.lines, {
      allowTemporary: false,
      autoCreateMissing: false,
      actor: "draft-sales-invoice-edit",
      defaultNewItemType: "STOCK",
    });

    const existing = (await findRecords<any>("InvoiceLines", { invoiceId: input.invoiceId }, 500)).rows;
    const existingById = new Map(existing.map((line: any) => [String(line.invoiceLineId || ""), line]));
    const desiredIds = new Set<string>();

    const desired = resolved.lines.map((line: any, index: number) => {
      const requestedId = String(input.lines[index]?.invoiceLineId || "").trim();
      if (requestedId && !existingById.has(requestedId) && !requestedId.startsWith(`${input.invoiceId}-EDIT-`)) {
        throw new Error(`Invalid draft invoice line reference: ${requestedId}`);
      }
      const invoiceLineId = activeLineId(input.invoiceId, requestedId);
      if (desiredIds.has(invoiceLineId)) throw new Error(`Duplicate draft invoice line: ${invoiceLineId}`);
      desiredIds.add(invoiceLineId);
      const netAmount = round2(Number(line.qty || 0) * Number(line.rate || 0));
      const gstAmount = round2(netAmount * input.gstRate);
      return {
        invoiceLineId,
        invoiceId: input.invoiceId,
        lineNo: index + 1,
        itemId: String(line.itemId || ""),
        description: String(line.itemName || line.description || ""),
        qty: Number(line.qty || 0),
        uom: String(line.uom || "Each"),
        rate: Number(line.rate || 0),
        netAmount,
        gstAmount,
        totalAmount: round2(netAmount + gstAmount),
        revenueAccountId: String(line.revenueAccountId || "ACC-4100"),
      };
    });

    const toAppend: Record<string, unknown>[] = [];
    let updated = 0;
    for (const line of desired) {
      if (existingById.has(line.invoiceLineId)) {
        const { invoiceLineId, ...patch } = line;
        await updateRecord("InvoiceLines", "invoiceLineId", invoiceLineId, patch, "draft-sales-invoice-edit");
        updated += 1;
      } else {
        toAppend.push(line);
      }
    }
    if (toAppend.length) await batchAppend("InvoiceLines", toAppend, "draft-sales-invoice-edit");

    let removed = 0;
    const stamp = Date.now();
    for (const line of existing) {
      const lineId = String(line.invoiceLineId || "");
      if (!lineId || desiredIds.has(lineId)) continue;
      await updateRecord(
        "InvoiceLines",
        "invoiceLineId",
        lineId,
        { invoiceId: `REMOVED:${input.invoiceId}:${stamp}`, lineNo: 0 },
        "draft-sales-invoice-remove-line",
      );
      removed += 1;
    }

    const netAmount = round2(desired.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
    const gstAmount = round2(desired.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0));
    const totalAmount = round2(netAmount + gstAmount);
    await updateRecord(
      "Invoices",
      "invoiceId",
      input.invoiceId,
      {
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        netAmount,
        gstAmount,
        totalAmount,
        paidAmount: 0,
        outstandingAmount: totalAmount,
      },
      "draft-sales-invoice-edit",
    );

    return NextResponse.json({
      ok: true,
      invoiceId: input.invoiceId,
      status: "DRAFT",
      totals: { netAmount, gstAmount, totalAmount },
      lines: desired,
      changes: { updated, added: toAppend.length, removed },
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Draft Sales Invoice save failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
