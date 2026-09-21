import { appendRecord, batchAppend, findRecords, listTable } from "@/lib/backend/apps-script";
import { postSalesCreditNoteAtomic } from "@/lib/accounting/atomic-sales-return";
import { round2 } from "@/lib/accounting/inventory";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

export type SalesReturnLineInput = { itemId: string; qty: number };

function year() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextCreditNoteNumber() {
  return documentSeriesId("CN", Number(year()));
}

function itemType(item: any) {
  const value = String(item?.itemType || "NON_STOCK").toUpperCase();
  return value === "STOCK" ? "STOCK" : value === "SERVICE" ? "SERVICE" : "NON_STOCK";
}

export function isCreditNote(row: any) {
  return String(row?.invoiceNumber || "").toUpperCase().startsWith("CN-");
}

export async function createSalesCreditNote(input: {
  invoiceId: string;
  returnDate: string;
  reason: string;
  lines: SalesReturnLineInput[];
}) {
  const original = (await findRecords<any>("Invoices", { invoiceId: input.invoiceId }, 1)).rows[0];
  if (!original || isCreditNote(original)) throw new Error("Original Sales Invoice not found");
  if (!["POSTED", "PARTLY_PAID", "PAID"].includes(String(original.status || "").toUpperCase())) {
    throw new Error("Sales Return / Credit Note requires a posted Sales Invoice");
  }
  if (String(input.reason || "").trim().length < 8) throw new Error("Return / Credit Note reason is required");
  if (!Array.isArray(input.lines) || !input.lines.length) throw new Error("Select at least one item quantity to return / credit");

  const [originalLinesResult, itemResult, creditNotesResult, allInvoiceLines] = await Promise.all([
    findRecords<any>("InvoiceLines", { invoiceId: input.invoiceId }, 500),
    listTable<any>("Items", 500, 0),
    findRecords<any>("Invoices", { sourceDocumentId: input.invoiceId }, 500),
    listTable<any>("InvoiceLines", 500, 0),
  ]);
  const originalLines = originalLinesResult.rows || [];
  if (!originalLines.length) throw new Error("Original Sales Invoice has no lines");
  const itemMap = new Map((itemResult.rows || []).map((row: any) => [String(row.itemId || row.itemCode || ""), row]));
  const activeCreditIds = new Set((creditNotesResult.rows || [])
    .filter((row: any) => isCreditNote(row) && !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase()))
    .map((row: any) => String(row.invoiceId || "")));
  const returnedByItem = new Map<string, number>();
  for (const line of allInvoiceLines.rows || []) {
    if (!activeCreditIds.has(String(line.invoiceId || ""))) continue;
    const itemId = String(line.itemId || "");
    returnedByItem.set(itemId, (returnedByItem.get(itemId) || 0) + Number(line.qty || 0));
  }

  const originalByItem = new Map<string, any[]>();
  for (const line of originalLines) {
    const itemId = String(line.itemId || "");
    originalByItem.set(itemId, [...(originalByItem.get(itemId) || []), line]);
  }

  const creditLines: any[] = [];
  let lineNo = 0;
  for (const requested of input.lines) {
    const itemId = String(requested.itemId || "").trim();
    const requestedQty = Number(requested.qty || 0);
    if (!(requestedQty > 0)) continue;
    const sourceLines = originalByItem.get(itemId) || [];
    if (!sourceLines.length) throw new Error(`Item ${itemId} is not on the original Sales Invoice`);
    const soldQty = sourceLines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
    const alreadyReturned = Number(returnedByItem.get(itemId) || 0);
    const available = Math.max(0, soldQty - alreadyReturned);
    if (requestedQty > available + 0.0001) throw new Error(`Return quantity for ${itemId} exceeds remaining returnable quantity ${available}`);
    const sourceNet = sourceLines.reduce((sum, line) => sum + Number(line.netAmount || 0), 0);
    const sourceGst = sourceLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0);
    const rate = soldQty > 0 ? sourceNet / soldQty : Number(sourceLines[0]?.rate || 0);
    const gstRate = sourceNet > 0 ? sourceGst / sourceNet : 0;
    const netAmount = round2(requestedQty * rate);
    const gstAmount = round2(netAmount * gstRate);
    const item = itemMap.get(itemId);
    lineNo += 1;
    creditLines.push({
      lineNo,
      itemId,
      description: String(item?.itemName || sourceLines[0]?.description || itemId),
      qty: requestedQty,
      uom: String(item?.uom || sourceLines[0]?.uom || "Each"),
      rate: round2(rate),
      netAmount,
      gstAmount,
      totalAmount: round2(netAmount + gstAmount),
      revenueAccountId: String(sourceLines[0]?.revenueAccountId || item?.revenueAccount || "ACC-4100"),
    });
  }
  if (!creditLines.length) throw new Error("Return quantity must be greater than zero");

  const invoiceId = documentSeriesId("CN", Number(year()));
  const invoiceNumber = await nextCreditNoteNumber();
  const netAmount = round2(creditLines.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
  const gstAmount = round2(creditLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0));
  const totalAmount = round2(netAmount + gstAmount);
  await appendRecord("Invoices", {
    invoiceId,
    invoiceNumber,
    customerId: original.customerId,
    projectId: original.projectId,
    invoiceDate: input.returnDate,
    dueDate: input.returnDate,
    netAmount,
    gstAmount,
    totalAmount,
    paidAmount: 0,
    outstandingAmount: 0,
    status: "DRAFT",
    sourceDocumentId: input.invoiceId,
    journalId: "",
    updateStock: true,
  }, "sales-return:credit-note-create");
  await batchAppend("InvoiceLines", creditLines.map((line) => ({
    invoiceLineId: `${invoiceId}-${String(line.lineNo).padStart(3, "0")}`,
    invoiceId,
    ...line,
  })), "sales-return:credit-note-create");
  await appendRecord("PaymentSchedules", {
    scheduleId: documentSeriesId("Return Reason"),
    sourceType: "SALES_RETURN_REASON",
    sourceId: invoiceId,
    projectId: original.projectId || "",
    partyId: original.customerId || "",
    milestone: String(input.reason).trim(),
    dueDate: input.returnDate,
    percentage: 0,
    amount: totalAmount,
    status: "PENDING",
  }, "sales-return:reason");

  return { invoiceId, invoiceNumber, totalAmount, status: "DRAFT", originalInvoiceId: input.invoiceId };
}

export async function postSalesCreditNote(
  creditNote: any,
  options: { approveIfDraft?: boolean } = {},
) {
  const creditNoteId = String(creditNote?.invoiceId || creditNote?.id || creditNote?.invoiceNumber || "").trim();
  if (!creditNoteId) throw new Error("Sales Credit Note is required");
  return postSalesCreditNoteAtomic({
    creditNoteId,
    approveIfDraft: options.approveIfDraft === true,
    createdBy: "sales-return:post",
    approvedBy: "Finance Controller",
  });
}
