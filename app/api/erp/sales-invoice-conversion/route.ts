import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { inventoryState, round2 } from "@/lib/accounting/inventory";

const schema = z.object({
  quoteId: z.string().trim().min(1),
  mode: z.enum(["FULL", "AVAILABLE"]).default("FULL"),
  invoiceDate: z.string().trim().min(8),
  dueDate: z.string().trim().optional().default(""),
});

function year() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextNumber() {
  const prefix = `SI-${year()}-`;
  const rows = await listTable<any>("Invoices", 500, 0);
  const max = (rows.rows || []).reduce((current: number, row: any) => {
    const value = String(row.invoiceNumber || "");
    if (!value.startsWith(prefix)) return current;
    const sequence = Number(value.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > current ? sequence : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

function itemType(item: any) {
  const value = String(item?.itemType || "STOCK").toUpperCase();
  return value === "SERVICE" || value === "NON_STOCK" ? value : "STOCK";
}

function addDays(date: string, days: number) {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(days || 0)));
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = schema.parse(await request.json());
    const [quoteResult, quoteLinesResult, itemResult, movementResult, invoiceResult, allInvoiceLines, customerResult] = await Promise.all([
      findRecords<any>("Quotes", { quoteId: input.quoteId }, 1),
      findRecords<any>("QuoteLines", { quoteId: input.quoteId }, 500),
      listTable<any>("Items", 500, 0),
      listTable<any>("StockMovements", 500, 0),
      findRecords<any>("Invoices", { sourceDocumentId: input.quoteId }, 500),
      listTable<any>("InvoiceLines", 500, 0),
      listTable<any>("Customers", 500, 0),
    ]);
    const quote = quoteResult.rows[0];
    if (!quote) throw new Error("Sales Quotation not found");
    const quoteStatus = String(quote.status || "").toUpperCase();
    if (!["APPROVED", "PART_INVOICED"].includes(quoteStatus)) throw new Error(`Sales Quotation is not available for conversion. Current status: ${quoteStatus}`);
    const quoteLines = [...(quoteLinesResult.rows || [])].sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0));
    if (!quoteLines.length) throw new Error("Sales Quotation has no lines");
    const temporary = quoteLines.filter((line: any) => !String(line.itemId || "").trim());
    if (temporary.length) throw new Error("All quotation TEMP items must be saved permanently in Item Master before Sales Invoice conversion");

    const activeInvoices = (invoiceResult.rows || []).filter((row: any) =>
      !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase())
      && !String(row.invoiceNumber || "").toUpperCase().startsWith("CN-"),
    );
    const existingDraft = activeInvoices.find((row: any) => String(row.status || "").toUpperCase() === "DRAFT");
    if (existingDraft) {
      return NextResponse.json({ ok: true, createdId: existingDraft.invoiceId, documentNumber: existingDraft.invoiceNumber || existingDraft.invoiceId, status: "existing-draft" });
    }

    const itemMap = new Map((itemResult.rows || []).map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
    const activeInvoiceIds = new Set(activeInvoices.map((row: any) => String(row.invoiceId || "")));
    const previouslyInvoicedByItem = new Map<string, number>();
    for (const line of allInvoiceLines.rows || []) {
      if (!activeInvoiceIds.has(String(line.invoiceId || ""))) continue;
      const itemId = String(line.itemId || "");
      previouslyInvoicedByItem.set(itemId, (previouslyInvoicedByItem.get(itemId) || 0) + Number(line.qty || 0));
    }

    const remainingByLine: Array<{ line: any; remainingQty: number; item: any }> = [];
    const consumedPrior = new Map<string, number>();
    for (const line of quoteLines) {
      const itemId = String(line.itemId || "");
      const item = itemMap.get(itemId);
      if (!item) throw new Error(`Item Master record not found: ${itemId}`);
      const priorTotal = Number(previouslyInvoicedByItem.get(itemId) || 0);
      const consumed = Number(consumedPrior.get(itemId) || 0);
      const priorAgainstThisLine = Math.min(Number(line.qty || 0), Math.max(0, priorTotal - consumed));
      consumedPrior.set(itemId, consumed + priorAgainstThisLine);
      remainingByLine.push({ line, item, remainingQty: Math.max(0, Number(line.qty || 0) - priorAgainstThisLine) });
    }

    const availableByItem = new Map<string, number>();
    for (const row of remainingByLine) {
      const itemId = String(row.line.itemId || "");
      if (availableByItem.has(itemId)) continue;
      if (itemType(row.item) !== "STOCK") {
        availableByItem.set(itemId, Number.POSITIVE_INFINITY);
        continue;
      }
      const state = inventoryState(
        (movementResult.rows || []).filter((movement: any) => String(movement.itemId || "") === itemId),
        Number(row.item.defaultRate || 0),
      );
      availableByItem.set(itemId, Math.max(0, Number(state.qty || 0)));
    }

    if (input.mode === "FULL") {
      const requiredByItem = new Map<string, number>();
      for (const row of remainingByLine) {
        if (itemType(row.item) !== "STOCK") continue;
        const itemId = String(row.line.itemId || "");
        requiredByItem.set(itemId, (requiredByItem.get(itemId) || 0) + row.remainingQty);
      }
      const shortages: string[] = [];
      for (const [itemId, required] of requiredByItem.entries()) {
        const available = Number(availableByItem.get(itemId) || 0);
        if (available + 0.0001 < required) {
          const item = itemMap.get(itemId);
          shortages.push(`${item?.itemCode || itemId}: required ${required}, available ${available}`);
        }
      }
      if (shortages.length) throw new Error(`Full fulfilment is not available. ${shortages.join("; ")}`);
    }

    const invoiceLines: any[] = [];
    let lineNo = 0;
    for (const row of remainingByLine) {
      if (row.remainingQty <= 0.0001) continue;
      const itemId = String(row.line.itemId || "");
      const type = itemType(row.item);
      const available = Number(availableByItem.get(itemId) ?? 0);
      const qty = type === "STOCK"
        ? (input.mode === "FULL" ? row.remainingQty : Math.min(row.remainingQty, Math.max(0, available)))
        : row.remainingQty;
      if (qty <= 0.0001) continue;
      if (type === "STOCK" && Number.isFinite(available)) availableByItem.set(itemId, Math.max(0, available - qty));
      lineNo += 1;
      const rate = Number(row.line.rate || 0);
      const originalNet = Number(row.line.netAmount || Number(row.line.qty || 0) * rate);
      const originalGst = Number(row.line.gstAmount || 0);
      const gstRate = originalNet > 0 ? originalGst / originalNet : 0;
      const netAmount = round2(qty * rate);
      const gstAmount = round2(netAmount * gstRate);
      invoiceLines.push({
        lineNo,
        itemId,
        description: String(row.item.itemName || row.line.description || itemId),
        qty,
        uom: String(row.item.uom || row.line.uom || "Each"),
        rate,
        netAmount,
        gstAmount,
        totalAmount: round2(netAmount + gstAmount),
        revenueAccountId: String(row.item.revenueAccount || "ACC-4100"),
      });
    }
    if (!invoiceLines.length) throw new Error("No remaining quotation quantity is currently available to invoice");

    const invoiceId = `INV-${year()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const invoiceNumber = await nextNumber();
    const netAmount = round2(invoiceLines.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
    const gstAmount = round2(invoiceLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0));
    const totalAmount = round2(netAmount + gstAmount);
    const customer = (customerResult.rows || []).find((row: any) => String(row.customerId || "") === String(quote.customerId || ""));
    const terms = Math.max(0, Math.trunc(Number(customer?.creditTermsDays || 0)));
    const dueDate = input.dueDate || addDays(input.invoiceDate, terms);

    await appendRecord("Invoices", {
      invoiceId,
      invoiceNumber,
      customerId: quote.customerId,
      projectId: quote.projectId,
      invoiceDate: input.invoiceDate,
      dueDate,
      netAmount,
      gstAmount,
      totalAmount,
      paidAmount: 0,
      outstandingAmount: totalAmount,
      status: "DRAFT",
      sourceDocumentId: input.quoteId,
      journalId: "",
      updateStock: true,
    }, "sales-fulfilment:quotation-conversion");
    await batchAppend("InvoiceLines", invoiceLines.map((line) => ({
      invoiceLineId: `${invoiceId}-${String(line.lineNo).padStart(3, "0")}`,
      invoiceId,
      ...line,
    })), "sales-fulfilment:quotation-conversion");

    const newInvoicedByItem = new Map(previouslyInvoicedByItem);
    for (const line of invoiceLines) newInvoicedByItem.set(String(line.itemId), (newInvoicedByItem.get(String(line.itemId)) || 0) + Number(line.qty || 0));
    const fullyInvoiced = quoteLines.every((line: any) => Number(newInvoicedByItem.get(String(line.itemId || "")) || 0) + 0.0001 >= quoteLines
      .filter((candidate: any) => String(candidate.itemId || "") === String(line.itemId || ""))
      .reduce((sum: number, candidate: any) => sum + Number(candidate.qty || 0), 0));
    await updateRecord("Quotes", "quoteId", input.quoteId, { status: fullyInvoiced ? "CONVERTED" : "PART_INVOICED" }, "sales-fulfilment:quotation-conversion");

    return NextResponse.json({
      ok: true,
      createdId: invoiceId,
      documentNumber: invoiceNumber,
      mode: input.mode,
      status: fullyInvoiced ? "fully-converted" : "partial-invoice-created",
      linesCreated: invoiceLines.length,
      netAmount,
      gstAmount,
      totalAmount,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Sales Invoice conversion failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
