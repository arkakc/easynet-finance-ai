import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, batchAppend, findRecords, updateRecord } from "@/lib/backend/apps-script";

const quoteSchema = z.object({
  quoteId: z.string().trim().min(1),
  invoiceNumber: z.string().trim().optional().default(""),
  invoiceDate: z.string().trim().min(8),
  dueDate: z.string().trim().optional().default(""),
  revenueAccountId: z.string().trim().optional().default("ACC-4100"),
});

const poSchema = z.object({
  poId: z.string().trim().min(1),
  billNumber: z.string().trim().optional().default(""),
  billDate: z.string().trim().min(8),
  dueDate: z.string().trim().optional().default(""),
  costAccountId: z.string().trim().optional().default("ACC-5100"),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

function id(prefix: string) {
  return `${prefix}-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; action?: "quoteToInvoice" | "poToBill"; payload?: unknown };
    requireSecret(body.secret);

    if (body.action === "quoteToInvoice") {
      const input = quoteSchema.parse(body.payload || {});
      const quoteResult = await findRecords<any>("Quotes", { quoteId: input.quoteId }, 1);
      const quote = quoteResult.rows[0];
      if (!quote) throw new Error("Quotation not found");
      if (String(quote.status).toUpperCase() !== "APPROVED") throw new Error("Quotation must be APPROVED before conversion");
      const existing = await findRecords<any>("Invoices", { sourceDocumentId: input.quoteId }, 10);
      if (existing.rows.length) throw new Error("This quotation has already been converted to an invoice");
      const sourceLines = await findRecords<any>("QuoteLines", { quoteId: input.quoteId }, 500);
      if (!sourceLines.rows.length) throw new Error("Quotation has no lines");

      const invoiceId = id("INV");
      const invoiceNumber = input.invoiceNumber || invoiceId;
      await appendRecord("Invoices", {
        invoiceId,
        invoiceNumber,
        customerId: quote.customerId,
        projectId: quote.projectId,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        netAmount: quote.netAmount,
        gstAmount: quote.gstAmount,
        totalAmount: quote.totalAmount,
        paidAmount: 0,
        outstandingAmount: quote.totalAmount,
        status: "DRAFT",
        sourceDocumentId: input.quoteId,
        journalId: "",
      }, "conversion-ui");

      await batchAppend("InvoiceLines", sourceLines.rows.map((line: any, index: number) => ({
        invoiceLineId: `${invoiceId}-${String(index + 1).padStart(3, "0")}`,
        invoiceId,
        lineNo: index + 1,
        itemId: line.itemId || "",
        description: line.description,
        qty: line.qty,
        uom: line.uom,
        rate: line.rate,
        netAmount: line.netAmount,
        gstAmount: line.gstAmount,
        totalAmount: line.totalAmount,
        revenueAccountId: input.revenueAccountId,
      })), "conversion-ui");

      await updateRecord("Quotes", "quoteId", input.quoteId, { status: "CONVERTED" }, "conversion-ui");
      return NextResponse.json({ ok: true, action: body.action, sourceId: input.quoteId, createdId: invoiceId, documentNumber: invoiceNumber });
    }

    if (body.action === "poToBill") {
      const input = poSchema.parse(body.payload || {});
      const poResult = await findRecords<any>("PurchaseOrders", { poId: input.poId }, 1);
      const po = poResult.rows[0];
      if (!po) throw new Error("Purchase order not found");
      if (String(po.status).toUpperCase() !== "APPROVED") throw new Error("Purchase order must be APPROVED before conversion");
      const existing = await findRecords<any>("SupplierBills", { poId: input.poId }, 10);
      if (existing.rows.length) throw new Error("This PO already has a supplier bill linked");
      const sourceLines = await findRecords<any>("POLines", { poId: input.poId }, 500);
      if (!sourceLines.rows.length) throw new Error("Purchase order has no lines");

      const billId = id("BILL");
      const billNumber = input.billNumber || billId;
      await appendRecord("SupplierBills", {
        billId,
        billNumber,
        supplierId: po.supplierId,
        projectId: po.projectId,
        billDate: input.billDate,
        dueDate: input.dueDate,
        poId: input.poId,
        netAmount: po.netAmount,
        gstAmount: po.gstAmount,
        totalAmount: po.totalAmount,
        paidAmount: 0,
        outstandingAmount: po.totalAmount,
        status: "DRAFT",
        sourceDocumentId: input.poId,
        journalId: "",
      }, "conversion-ui");

      await batchAppend("SupplierBillLines", sourceLines.rows.map((line: any, index: number) => ({
        billLineId: `${billId}-${String(index + 1).padStart(3, "0")}`,
        billId,
        lineNo: index + 1,
        itemId: line.itemId || "",
        description: line.description,
        qty: line.qty,
        uom: line.uom,
        rate: line.rate,
        netAmount: line.netAmount,
        gstAmount: line.gstAmount,
        totalAmount: line.totalAmount,
        costAccountId: input.costAccountId,
      })), "conversion-ui");

      await updateRecord("PurchaseOrders", "poId", input.poId, { status: "BILLED" }, "conversion-ui");
      return NextResponse.json({ ok: true, action: body.action, sourceId: input.poId, createdId: billId, documentNumber: billNumber });
    }

    throw new Error("Unsupported conversion action");
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Conversion failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
