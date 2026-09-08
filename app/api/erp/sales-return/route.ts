import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { createSalesCreditNote, isCreditNote } from "@/lib/accounting/sales-return";

const createSchema = z.object({
  invoiceId: z.string().trim().min(1),
  returnDate: z.string().trim().min(8),
  reason: z.string().trim().min(8).max(500),
  lines: z.array(z.object({ itemId: z.string().trim().min(1), qty: z.coerce.number().finite().positive() })).min(1),
});

export async function GET(request: Request) {
  try {
    await requirePermission("sales.read");
    const invoiceId = new URL(request.url).searchParams.get("invoiceId")?.trim() || "";
    if (!invoiceId) throw new Error("Original Sales Invoice is required");
    const [invoiceResult, invoiceLinesResult, itemResult, creditResult, allLines] = await Promise.all([
      findRecords<any>("Invoices", { invoiceId }, 1),
      findRecords<any>("InvoiceLines", { invoiceId }, 500),
      listTable<any>("Items", 500, 0),
      findRecords<any>("Invoices", { sourceDocumentId: invoiceId }, 500),
      listTable<any>("InvoiceLines", 500, 0),
    ]);
    const invoice = invoiceResult.rows[0];
    if (!invoice || isCreditNote(invoice)) throw new Error("Original Sales Invoice not found");
    if (!["POSTED", "PARTLY_PAID", "PAID"].includes(String(invoice.status || "").toUpperCase())) {
      throw new Error("Sales Return is available only for a posted Sales Invoice");
    }
    const itemMap = new Map((itemResult.rows || []).map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
    const creditIds = new Set((creditResult.rows || [])
      .filter((row: any) => isCreditNote(row) && !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase()))
      .map((row: any) => String(row.invoiceId || "")));
    const returnedByItem = new Map<string, number>();
    for (const line of allLines.rows || []) {
      if (!creditIds.has(String(line.invoiceId || ""))) continue;
      const itemId = String(line.itemId || "");
      returnedByItem.set(itemId, (returnedByItem.get(itemId) || 0) + Number(line.qty || 0));
    }
    const soldByItem = new Map<string, { qty: number; net: number; gst: number; rate: number; line: any }>();
    for (const line of invoiceLinesResult.rows || []) {
      const itemId = String(line.itemId || "");
      const current = soldByItem.get(itemId) || { qty: 0, net: 0, gst: 0, rate: Number(line.rate || 0), line };
      current.qty += Number(line.qty || 0);
      current.net += Number(line.netAmount || 0);
      current.gst += Number(line.gstAmount || 0);
      soldByItem.set(itemId, current);
    }
    const lines = [...soldByItem.entries()].map(([itemId, value]) => {
      const item = itemMap.get(itemId);
      const returnedQty = Number(returnedByItem.get(itemId) || 0);
      return {
        itemId,
        itemCode: String(item?.itemCode || itemId),
        itemName: String(item?.itemName || value.line?.description || itemId),
        itemType: String(item?.itemType || "NON_STOCK"),
        uom: String(item?.uom || value.line?.uom || "Each"),
        soldQty: value.qty,
        alreadyReturnedQty: returnedQty,
        returnableQty: Math.max(0, value.qty - returnedQty),
        rate: value.qty > 0 ? value.net / value.qty : value.rate,
      };
    }).filter((line) => line.returnableQty > 0.0001);

    return NextResponse.json({
      ok: true,
      invoice: {
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        projectId: invoice.projectId,
        totalAmount: Number(invoice.totalAmount || 0),
        outstandingAmount: Number(invoice.outstandingAmount || 0),
        status: invoice.status,
      },
      lines,
      existingCreditNotes: (creditResult.rows || []).filter((row: any) => isCreditNote(row)).map((row: any) => ({
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        totalAmount: Number(row.totalAmount || 0),
        status: row.status,
        createdAt: row.createdAt || "",
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sales return readiness failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = createSchema.parse(await request.json());
    const result = await createSalesCreditNote(input);
    return NextResponse.json({ ok: true, creditNote: result });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Sales Return / Credit Note creation failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
