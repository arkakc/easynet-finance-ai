import { randomUUID } from "node:crypto";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { postJournal, type PostingLine } from "@/lib/accounting/posting";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { round2 } from "@/lib/accounting/inventory";

export type SalesReturnLineInput = { itemId: string; qty: number };

function year() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextCreditNoteNumber() {
  const prefix = `CN-${year()}-`;
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

  const invoiceId = `CRN-${year()}-${randomUUID().slice(0, 8).toUpperCase()}`;
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
    scheduleId: `RETREASON-${randomUUID().slice(0, 12).toUpperCase()}`,
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

export async function postSalesCreditNote(creditNote: any) {
  if (!isCreditNote(creditNote)) throw new Error("Document is not a Sales Credit Note");
  if (String(creditNote.status || "").toUpperCase() === "POSTED" && String(creditNote.journalId || "")) {
    return { recordType: "invoice", recordId: creditNote.invoiceId, status: "already-posted", journalId: creditNote.journalId };
  }
  const originalInvoiceId = String(creditNote.sourceDocumentId || "").trim();
  if (!originalInvoiceId) throw new Error("Credit Note has no original Sales Invoice reference");
  const original = (await findRecords<any>("Invoices", { invoiceId: originalInvoiceId }, 1)).rows[0];
  if (!original || isCreditNote(original)) throw new Error("Original Sales Invoice not found");
  if (!["POSTED", "PARTLY_PAID", "PAID"].includes(String(original.status || "").toUpperCase())) throw new Error("Original Sales Invoice is not posted");

  const [creditLinesResult, itemResult, movementsResult, reasonResult] = await Promise.all([
    findRecords<any>("InvoiceLines", { invoiceId: creditNote.invoiceId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
    findRecords<any>("PaymentSchedules", { sourceId: creditNote.invoiceId, sourceType: "SALES_RETURN_REASON" }, 20),
  ]);
  const lines = creditLinesResult.rows || [];
  if (!lines.length) throw new Error("Credit Note has no lines");
  const reason = (reasonResult.rows || []).find((row: any) => String(row.status || "").toUpperCase() !== "CANCELLED");
  if (!reason) throw new Error("Credit Note reason is missing");
  const items = new Map((itemResult.rows || []).map((item: any) => [String(item.itemId || item.itemCode || ""), item]));

  const postingLines: PostingLine[] = [];
  const revenue = new Map<string, number>();
  for (const line of lines) {
    const item = items.get(String(line.itemId || ""));
    const accountId = String(line.revenueAccountId || item?.revenueAccount || "ACC-4100");
    revenue.set(accountId, round2((revenue.get(accountId) || 0) + Number(line.netAmount || 0)));
  }
  for (const [accountId, amount] of revenue.entries()) {
    if (amount > 0) postingLines.push({ accountId, debit: amount, customerId: original.customerId, projectId: original.projectId, description: "Sales return / revenue reversal" });
  }
  if (Number(creditNote.gstAmount || 0) > 0) {
    postingLines.push({ accountId: INITIAL_ACCOUNT_IDS.gstPayable, debit: Number(creditNote.gstAmount || 0), customerId: original.customerId, projectId: original.projectId, taxCode: "GST", description: "Reverse Output GST" });
  }

  const originalOutstanding = Number(original.outstandingAmount || 0);
  const creditTotal = Number(creditNote.totalAmount || 0);
  const arCredit = round2(Math.min(originalOutstanding, creditTotal));
  const customerCredit = round2(Math.max(0, creditTotal - arCredit));
  if (arCredit > 0) postingLines.push({ accountId: INITIAL_ACCOUNT_IDS.accountsReceivable, credit: arCredit, customerId: original.customerId, projectId: original.projectId, description: "Reduce Accounts Receivable" });
  if (customerCredit > 0) postingLines.push({ accountId: INITIAL_ACCOUNT_IDS.customerAdvances, credit: customerCredit, customerId: original.customerId, projectId: original.projectId, description: "Customer credit / refundable balance" });

  const stockReturnRows: any[] = [];
  const cogsCredits = new Map<string, number>();
  let inventoryDebit = 0;
  for (const line of lines) {
    const itemId = String(line.itemId || "");
    const item = items.get(itemId);
    if (itemType(item) !== "STOCK") continue;
    const originalIssues = (movementsResult.rows || []).filter((movement: any) =>
      String(movement.sourceDocumentId || "") === originalInvoiceId
      && String(movement.itemId || "") === itemId
      && String(movement.movementType || "") === "SALES_ISSUE",
    );
    const issuedQty = originalIssues.reduce((sum: number, movement: any) => sum + Number(movement.qtyOut || 0), 0);
    if (issuedQty <= 0.0001) throw new Error(`Original stock issue not found for ${item?.itemCode || itemId}`);
    const issuedValue = originalIssues.reduce((sum: number, movement: any) => sum + Number(movement.value || Number(movement.qtyOut || 0) * Number(movement.unitCost || 0)), 0);
    const originalCostRate = issuedValue / issuedQty;
    const value = round2(Number(line.qty || 0) * originalCostRate);
    inventoryDebit = round2(inventoryDebit + value);
    const costAccount = String(item?.costAccount || "ACC-5100");
    cogsCredits.set(costAccount, round2((cogsCredits.get(costAccount) || 0) + value));
    stockReturnRows.push({
      movementId: `RET-STK-${creditNote.invoiceId}-${String(stockReturnRows.length + 1).padStart(3, "0")}`,
      movementDate: String(creditNote.invoiceDate),
      itemId,
      projectId: creditNote.projectId || "",
      movementType: "SALES_RETURN",
      qtyIn: Number(line.qty || 0),
      qtyOut: 0,
      unitCost: round2(originalCostRate),
      value,
      sourceDocumentId: creditNote.invoiceId,
    });
  }
  if (inventoryDebit > 0) postingLines.push({ accountId: INITIAL_ACCOUNT_IDS.inventory, debit: inventoryDebit, customerId: original.customerId, projectId: original.projectId, description: "Inventory returned by customer" });
  for (const [accountId, amount] of cogsCredits.entries()) postingLines.push({ accountId, credit: amount, customerId: original.customerId, projectId: original.projectId, description: "Reverse cost of goods sold" });

  let stockCreated = false;
  try {
    const existingReturns = (movementsResult.rows || []).filter((movement: any) => String(movement.sourceDocumentId || "") === String(creditNote.invoiceId) && String(movement.movementType || "") === "SALES_RETURN");
    if (!existingReturns.length && stockReturnRows.length) {
      await batchAppend("StockMovements", stockReturnRows, "sales-return:stock");
      stockCreated = true;
    }
    const journal = await postJournal({
      postingDate: String(creditNote.invoiceDate),
      documentType: "SALES_CREDIT_NOTE",
      documentId: creditNote.invoiceId,
      documentNumber: String(creditNote.invoiceNumber || creditNote.invoiceId),
      reference: String(reason.milestone || `Credit Note ${creditNote.invoiceNumber}`),
      projectId: original.projectId,
      lines: postingLines,
    });
    const newOutstanding = round2(Math.max(0, originalOutstanding - arCredit));
    const originalStatus = newOutstanding <= 0.001 ? "PAID" : Number(original.paidAmount || 0) > 0.001 ? "PARTLY_PAID" : "POSTED";
    await updateRecord("Invoices", "invoiceId", originalInvoiceId, { outstandingAmount: newOutstanding, status: originalStatus }, "sales-return:receivable-adjustment");
    await updateRecord("Invoices", "invoiceId", creditNote.invoiceId, { status: "POSTED", journalId: journal.journalId }, "sales-return:post");
    await updateRecord("PaymentSchedules", "scheduleId", reason.scheduleId, { status: "POSTED" }, "sales-return:reason-posted");
    return { recordType: "invoice", recordId: creditNote.invoiceId, status: "POSTED", journalId: journal.journalId, originalInvoiceId, arCredit, customerCredit, stockReturned: stockReturnRows.length };
  } catch (error) {
    if (stockCreated && stockReturnRows.length) {
      try {
        await batchAppend("StockMovements", stockReturnRows.map((row: any, index: number) => ({
          movementId: `RB-${row.movementId}-${String(index + 1).padStart(2, "0")}`,
          movementDate: row.movementDate,
          itemId: row.itemId,
          projectId: row.projectId,
          movementType: "SALES_RETURN_ROLLBACK",
          qtyIn: 0,
          qtyOut: row.qtyIn,
          unitCost: row.unitCost,
          value: row.value,
          sourceDocumentId: creditNote.invoiceId,
        })), "sales-return:stock-rollback");
      } catch { /* best effort; immutable movement trail remains auditable */ }
    }
    throw error;
  }
}
