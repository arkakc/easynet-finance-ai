import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, batchAppend, findRecords, updateRecord } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

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

async function assertAccount(accountId: string) {
  const result = await findRecords<any>("Accounts", { accountId }, 1);
  const account = result.rows[0];
  if (!account || String(account.active).toLowerCase() === "false") throw new Error(`Account does not exist or is inactive: ${accountId}`);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { secret?: string; action?: "quoteToInvoice" | "poToBill"; payload?: unknown };
    requireSecret(body.secret);

    if (body.action === "quoteToInvoice") {
      const input = quoteSchema.parse(body.payload || {});
      await assertAccount(input.revenueAccountId);

      const quoteResult = await findRecords<any>("Quotes", { quoteId: input.quoteId }, 1);
      const quote = quoteResult.rows[0];
      if (!quote) throw new Error("Quotation not found");
      const quoteStatus = String(quote.status || "").toUpperCase();
      if (!["APPROVED", "CONVERTED"].includes(quoteStatus)) throw new Error("Quotation must be APPROVED before conversion");

      const sourceLines = await findRecords<any>("QuoteLines", { quoteId: input.quoteId }, 500);
      if (!sourceLines.rows.length) throw new Error("Quotation has no lines");
      const existing = await findRecords<any>("Invoices", { sourceDocumentId: input.quoteId }, 10);
      if (existing.rows.length > 1) throw new Error("Multiple invoices are linked to this quotation; manual review required");

      const invoice = existing.rows[0];
      const invoiceId = invoice?.invoiceId || id("INV");
      const invoiceNumber = invoice?.invoiceNumber || input.invoiceNumber || invoiceId;

      if (!invoice) {
        await appendRecord("Invoices", {
          invoiceId,
          invoiceNumber,
          customerId: quote.customerId,
          projectId: quote.projectId,
          invoiceDate: normalizeAccountingDate(input.invoiceDate),
          dueDate: input.dueDate ? normalizeAccountingDate(input.dueDate) : "",
          netAmount: quote.netAmount,
          gstAmount: quote.gstAmount,
          totalAmount: quote.totalAmount,
          paidAmount: 0,
          outstandingAmount: quote.totalAmount,
          status: "DRAFT",
          sourceDocumentId: input.quoteId,
          journalId: "",
        }, "conversion-ui");
      }

      const currentLines = await findRecords<any>("InvoiceLines", { invoiceId }, 500);
      const existingLineIds = new Set(currentLines.rows.map((line: any) => String(line.invoiceLineId)));
      const desiredLines = sourceLines.rows.map((line: any, index: number) => ({
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
      }));
      const missingLines = desiredLines.filter((line) => !existingLineIds.has(line.invoiceLineId));
      if (missingLines.length) await batchAppend("InvoiceLines", missingLines, "conversion-ui");

      if (quoteStatus !== "CONVERTED") {
        await updateRecord("Quotes", "quoteId", input.quoteId, { status: "CONVERTED" }, "conversion-ui");
      }

      return NextResponse.json({
        ok: true,
        action: body.action,
        sourceId: input.quoteId,
        createdId: invoiceId,
        documentNumber: invoiceNumber,
        status: invoice ? (missingLines.length ? "recovered-partial-conversion" : "already-converted") : "created",
        linesCreated: missingLines.length,
      });
    }

    if (body.action === "poToBill") {
      const input = poSchema.parse(body.payload || {});
      await assertAccount(input.costAccountId);

      const poResult = await findRecords<any>("PurchaseOrders", { poId: input.poId }, 1);
      const po = poResult.rows[0];
      if (!po) throw new Error("Purchase order not found");
      const poStatus = String(po.status || "").toUpperCase();
      if (!["APPROVED", "BILL_CREATED", "BILLED"].includes(poStatus)) throw new Error("Purchase order must be APPROVED before conversion");

      const sourceLines = await findRecords<any>("POLines", { poId: input.poId }, 500);
      if (!sourceLines.rows.length) throw new Error("Purchase order has no lines");
      const existing = await findRecords<any>("SupplierBills", { poId: input.poId }, 10);
      if (existing.rows.length > 1) throw new Error("Multiple supplier bills are linked to this PO; manual review required");

      const bill = existing.rows[0];
      const billId = bill?.billId || id("BILL");
      const billNumber = bill?.billNumber || input.billNumber || billId;

      if (!bill) {
        await appendRecord("SupplierBills", {
          billId,
          billNumber,
          supplierId: po.supplierId,
          projectId: po.projectId,
          billDate: normalizeAccountingDate(input.billDate),
          dueDate: input.dueDate ? normalizeAccountingDate(input.dueDate) : "",
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
      }

      const currentLines = await findRecords<any>("SupplierBillLines", { billId }, 500);
      const existingLineIds = new Set(currentLines.rows.map((line: any) => String(line.billLineId)));
      const desiredLines = sourceLines.rows.map((line: any, index: number) => ({
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
      }));
      const missingLines = desiredLines.filter((line) => !existingLineIds.has(line.billLineId));
      if (missingLines.length) await batchAppend("SupplierBillLines", missingLines, "conversion-ui");

      if (poStatus === "APPROVED") {
        await updateRecord("PurchaseOrders", "poId", input.poId, { status: "BILL_CREATED" }, "conversion-ui");
      }

      return NextResponse.json({
        ok: true,
        action: body.action,
        sourceId: input.poId,
        createdId: billId,
        documentNumber: billNumber,
        status: bill ? (missingLines.length ? "recovered-partial-conversion" : "already-converted") : "created",
        linesCreated: missingLines.length,
      });
    }

    throw new Error("Unsupported conversion action");
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Conversion failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
