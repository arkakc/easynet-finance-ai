import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { resolveTransactionItems } from "@/lib/erp/item-linking";
import { round2, weightedRate } from "@/lib/accounting/inventory";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const quoteSchema = z.object({
  quoteId: z.string().trim().min(1),
  invoiceNumber: z.string().trim().optional().default(""),
  invoiceDate: z.string().trim().min(8),
  dueDate: z.string().trim().optional().default(""),
  revenueAccountId: z.string().trim().optional().default("ACC-4100"),
  updateStock: z.coerce.boolean().optional().default(true),
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
function id(prefix: string) { return documentSeriesId(prefix); }
async function assertAccount(accountId: string) {
  const result = await findRecords<any>("Accounts", { accountId }, 1);
  const account = result.rows[0];
  if (!account || String(account.active).toLowerCase() === "false") throw new Error(`Account does not exist or is inactive: ${accountId}`);
}
function itemType(item: any) { return String(item?.itemType || "NON_STOCK").toUpperCase(); }

async function quoteToInvoice(input: z.infer<typeof quoteSchema>) {
  await assertAccount(input.revenueAccountId);
  const quote = (await findRecords<any>("Quotes", { quoteId: input.quoteId }, 1)).rows[0];
  if (!quote) throw new Error("Quotation not found");
  const quoteStatus = String(quote.status || "").toUpperCase();
  if (!["APPROVED", "CONVERTED"].includes(quoteStatus)) throw new Error("Quotation must be APPROVED before conversion");
  const sourceLines = await findRecords<any>("QuoteLines", { quoteId: input.quoteId }, 500);
  if (!sourceLines.rows.length) throw new Error("Quotation has no lines");
  const resolved = await resolveTransactionItems(sourceLines.rows, { allowTemporary: false, autoCreateMissing: true, actor: "quote-to-invoice:item-linking", defaultNewItemType: "STOCK" });
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
      sourceQuoteId: input.quoteId,
      journalId: "",
      updateStock: input.updateStock,
    }, "conversion-ui");
  }
  const currentLines = await findRecords<any>("InvoiceLines", { invoiceId }, 500);
  const existingLineIds = new Set(currentLines.rows.map((line: any) => String(line.invoiceLineId)));
  const desiredLines = resolved.lines.map((line: any, index: number) => ({
    invoiceLineId: `${invoiceId}-${String(index + 1).padStart(3, "0")}`,
    invoiceId,
    lineNo: index + 1,
    itemId: line.itemId,
    description: line.itemName || line.description,
    qty: line.qty,
    uom: line.uom,
    rate: line.rate,
    netAmount: line.netAmount,
    gstAmount: line.gstAmount,
    totalAmount: line.totalAmount,
    revenueAccountId: line.revenueAccountId || input.revenueAccountId,
  }));
  const missingLines = desiredLines.filter((line) => !existingLineIds.has(line.invoiceLineId));
  if (missingLines.length) await batchAppend("InvoiceLines", missingLines, "conversion-ui");
  if (quoteStatus !== "CONVERTED") await updateRecord("Quotes", "quoteId", input.quoteId, { status: "CONVERTED" }, "conversion-ui");
  return { ok: true, action: "quoteToInvoice", sourceId: input.quoteId, createdId: invoiceId, documentNumber: invoiceNumber, status: invoice ? (missingLines.length ? "recovered-partial-conversion" : "already-converted") : "created", linesCreated: missingLines.length, itemsCreated: resolved.createdItems.length };
}

async function poToPartialBill(input: z.infer<typeof poSchema>) {
  await assertAccount(input.costAccountId);
  const po = (await findRecords<any>("PurchaseOrders", { poId: input.poId }, 1)).rows[0];
  if (!po || String(po.poNumber || "").toUpperCase().startsWith("SUPQ-")) throw new Error("Purchase Order not found");
  const poStatus = String(po.status || "").toUpperCase();
  const allowed = ["APPROVED", "PART_RECEIVED", "RECEIVED", "PART_BILLED", "CONVERTED", "BILL_CREATED", "BILLED", "CLOSED", "CLOSED_PARTIAL"];
  if (!allowed.includes(poStatus)) throw new Error("Purchase Order must be APPROVED before Supplier Invoice conversion");

  const existingBills = await findRecords<any>("SupplierBills", { poId: input.poId }, 500);
  const openDraft = existingBills.rows.find((bill: any) => String(bill.status || "").toUpperCase() === "DRAFT");
  if (openDraft) {
    return { ok: true, action: "poToBill", sourceId: input.poId, createdId: openDraft.billId, documentNumber: openDraft.billNumber, status: "existing-draft", linesCreated: 0 };
  }

  const [sourceLines, itemsResult, receiptsResult, allBillLines] = await Promise.all([
    findRecords<any>("POLines", { poId: input.poId }, 500),
    listTable<any>("Items", 500, 0),
    findRecords<any>("StockMovements", { sourceDocumentId: input.poId }, 500),
    listTable<any>("SupplierBillLines", 500, 0),
  ]);
  if (!sourceLines.rows.length) throw new Error("Purchase Order has no lines");
  const resolved = await resolveTransactionItems(sourceLines.rows, { allowTemporary: false, autoCreateMissing: true, actor: "po-to-bill:item-linking", defaultNewItemType: "STOCK" });
  const items = new Map(itemsResult.rows.map((item: any) => [String(item.itemId || ""), item]));
  for (const createdItem of resolved.createdItems) items.set(String(createdItem.itemId || ""), createdItem);

  const priorBillIds = new Set(existingBills.rows
    .filter((bill: any) => !["CANCELLED", "REVERSED"].includes(String(bill.status || "").toUpperCase()))
    .map((bill: any) => String(bill.billId || "")));
  const priorBilledByItem = new Map<string, number>();
  for (const line of allBillLines.rows) {
    if (!priorBillIds.has(String(line.billId || ""))) continue;
    const itemId = String(line.itemId || "");
    priorBilledByItem.set(itemId, (priorBilledByItem.get(itemId) || 0) + Number(line.qty || 0));
  }

  const groupedPo = new Map<string, any[]>();
  for (const line of resolved.lines) {
    const itemId = String(line.itemId || "");
    groupedPo.set(itemId, [...(groupedPo.get(itemId) || []), line]);
  }

  const billLines: any[] = [];
  let lineNo = 0;
  for (const [itemId, poLines] of groupedPo.entries()) {
    const item = items.get(itemId);
    if (!item) throw new Error(`Item Master record not found: ${itemId}`);
    const orderedQty = poLines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
    const previouslyBilled = Number(priorBilledByItem.get(itemId) || 0);
    let availableQty = Math.max(0, orderedQty - previouslyBilled);

    if (itemType(item) === "STOCK") {
      const receivedQty = receiptsResult.rows
        .filter((movement: any) => String(movement.itemId || "") === itemId && String(movement.movementType || "") === "PURCHASE_RECEIPT")
        .reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
      availableQty = Math.max(0, Math.min(orderedQty, receivedQty) - previouslyBilled);
    }
    if (availableQty <= 0.0001) continue;

    lineNo += 1;
    const rate = weightedRate(poLines);
    const originalNet = poLines.reduce((sum, line) => sum + Number(line.netAmount || Number(line.qty || 0) * Number(line.rate || 0)), 0);
    const originalGst = poLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0);
    const gstRate = originalNet > 0 ? originalGst / originalNet : 0;
    const netAmount = round2(availableQty * rate);
    const gstAmount = round2(netAmount * gstRate);
    const totalAmount = round2(netAmount + gstAmount);
    billLines.push({
      lineNo,
      itemId,
      description: item.itemName || poLines[0]?.description || itemId,
      qty: availableQty,
      uom: item.uom || poLines[0]?.uom || "Each",
      rate,
      netAmount,
      gstAmount,
      totalAmount,
      costAccountId: item.costAccount || input.costAccountId,
    });
  }

  if (!billLines.length) {
    if (poStatus === "BILLED") throw new Error("Purchase Order is already fully billed");
    throw new Error("No PO quantity is currently available to bill. Receive stock items first or check previously billed quantities.");
  }

  const billId = id("BILL");
  const billNumber = input.billNumber || billId;
  const netAmount = round2(billLines.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
  const gstAmount = round2(billLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0));
  const totalAmount = round2(netAmount + gstAmount);
  await appendRecord("SupplierBills", {
    billId,
    billNumber,
    supplierId: po.supplierId,
    projectId: po.projectId,
    billDate: normalizeAccountingDate(input.billDate),
    dueDate: input.dueDate ? normalizeAccountingDate(input.dueDate) : "",
    poId: input.poId,
    netAmount,
    gstAmount,
    totalAmount,
    paidAmount: 0,
    outstandingAmount: totalAmount,
    status: "DRAFT",
    sourceDocumentId: input.poId,
    sourcePurchaseOrderId: input.poId,
    journalId: "",
  }, "conversion-ui");
  await batchAppend("SupplierBillLines", billLines.map((line) => ({
    billLineId: `${billId}-${String(line.lineNo).padStart(3, "0")}`,
    billId,
    ...line,
  })), "conversion-ui");
  if (!["PART_BILLED", "BILLED", "CLOSED", "CLOSED_PARTIAL"].includes(poStatus)) await updateRecord("PurchaseOrders", "poId", input.poId, { status: "BILL_CREATED" }, "conversion-ui");

  return {
    ok: true,
    action: "poToBill",
    sourceId: input.poId,
    createdId: billId,
    documentNumber: billNumber,
    status: "created-partial-capable",
    linesCreated: billLines.length,
    itemsCreated: resolved.createdItems.length,
    netAmount,
    gstAmount,
    totalAmount,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { secret?: string; action?: "quoteToInvoice" | "poToBill"; payload?: unknown };
    requireSecret(body.secret);
    if (body.action === "quoteToInvoice") return NextResponse.json(await quoteToInvoice(quoteSchema.parse(body.payload || {})));
    if (body.action === "poToBill") return NextResponse.json(await poToPartialBill(poSchema.parse(body.payload || {})));
    throw new Error("Unsupported conversion action");
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Conversion failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
