import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  appendRecord,
  batchAppend,
  findRecords,
  listTable,
  updateRecord,
} from "@/lib/backend/apps-script";
import {
  expensePosting,
  postJournal,
  receiptPosting,
  salesInvoicePostingByLines,
  supplierBillPostingByLines,
  supplierBillPostingMixed,
  supplierPaymentPosting,
} from "@/lib/accounting/posting";
import {
  ensureAccountingInfrastructure,
  deferredRevenuePolicy,
  purchasePriceVarianceTolerancePct,
} from "@/lib/accounting/infrastructure";
import {
  addMonthsMonthEnd,
  inventoryState,
  round2,
  round4,
  splitEvenly,
  weightedRate,
} from "@/lib/accounting/inventory";

const text = z.string().trim();
const optionalText = text.optional().default("");
const money = z.coerce.number().finite().nonnegative();
const qty = z.coerce.number().finite().positive();

const lineSchema = z.object({
  itemId: optionalText,
  itemCode: optionalText,
  itemName: optionalText,
  itemType: optionalText,
  description: text.min(1),
  qty: qty.default(1),
  uom: optionalText.default("Each"),
  rate: money,
});

const commercialSchema = z.object({
  documentNumber: optionalText,
  partyId: text.min(1),
  projectId: optionalText,
  documentDate: text.min(8),
  dueDate: optionalText,
  expiryDate: optionalText,
  gstRate: z.coerce.number().finite().min(0).max(1).default(0),
  accountId: optionalText,
  poId: optionalText,
  lines: z.array(lineSchema).min(1),
});

const paymentSchema = z.object({
  paymentNumber: optionalText,
  paymentType: z.enum(["RECEIVE", "PAY"]),
  partyType: z.enum(["Customer", "Supplier"]),
  partyId: text.min(1),
  projectId: optionalText,
  paymentDate: text.min(8),
  amount: money.refine((value) => value > 0, "Amount must be greater than zero"),
  paymentMethod: text.min(1),
  cashBankAccountId: text.min(1),
  reference: optionalText,
  againstDocumentType: optionalText,
  againstDocumentId: optionalText,
});

const expenseSchema = z.object({
  expenseNumber: optionalText,
  expenseDate: text.min(8),
  supplierId: optionalText,
  projectId: optionalText,
  expenseAccountId: text.min(1),
  description: text.min(1),
  netAmount: money,
  gstAmount: money.default(0),
  paymentMethod: text.min(1),
  cashBankAccountId: text.min(1),
});

const postSchema = z.object({
  recordType: z.enum(["invoice", "supplierBill", "payment", "expense"]),
  recordId: text.min(1),
});

const allocateAdvanceSchema = z.object({
  paymentId: text.min(1),
  againstDocumentType: z.enum(["Sales Invoice", "Supplier Invoice"]),
  againstDocumentId: text.min(1),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

function id(prefix: string) {
  return `${prefix}-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function totals(lines: z.infer<typeof lineSchema>[], gstRate: number) {
  const normalized = lines.map((line, index) => {
    const netAmount = round2(line.qty * line.rate);
    const gstAmount = round2(netAmount * gstRate);
    return { ...line, lineNo: index + 1, netAmount, gstAmount, totalAmount: round2(netAmount + gstAmount) };
  });
  const net = round2(normalized.reduce((sum, line) => sum + line.netAmount, 0));
  const gst = round2(normalized.reduce((sum, line) => sum + line.gstAmount, 0));
  return { lines: normalized, net, gst, total: round2(net + gst) };
}

async function gstStatus() {
  const result = await findRecords<{ key: string; value: string }>("Settings", { key: "gst_status" }, 1);
  return String(result.rows[0]?.value || "UNVERIFIED").toUpperCase();
}

async function assertParty(table: "Customers" | "Suppliers", idField: "customerId" | "supplierId", value: string) {
  const result = await findRecords(table, { [idField]: value }, 1);
  if (!result.rows.length) throw new Error(`${table === "Customers" ? "Customer" : "Supplier"} does not exist`);
}

async function assertProject(projectId: string) {
  if (!projectId) return;
  const result = await findRecords("Projects", { projectId }, 1);
  if (!result.rows.length) throw new Error("Project does not exist");
}

async function itemMasterMap() {
  const result = await listTable<any>("Items", 500, 0);
  return new Map(result.rows.map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
}

function itemType(item: any) {
  return String(item?.itemType || "NON_STOCK").toUpperCase();
}

async function createCommercial(type: "quote" | "purchaseOrder" | "invoice" | "supplierBill", raw: unknown) {
  const parsed = commercialSchema.parse(raw);
  const isSales = type === "quote" || type === "invoice";

  await assertParty(isSales ? "Customers" : "Suppliers", isSales ? "customerId" : "supplierId", parsed.partyId);
  await assertProject(parsed.projectId);

  const t = totals(parsed.lines, parsed.gstRate);
  const items = type === "invoice" || type === "supplierBill" ? await itemMasterMap() : new Map<string, any>();

  if (type === "quote") {
    const quoteId = id("QT");
    const quoteNumber = parsed.documentNumber || quoteId;
    await appendRecord("Quotes", {
      quoteId, quoteNumber, customerId: parsed.partyId, projectId: parsed.projectId,
      quoteDate: parsed.documentDate, expiryDate: parsed.expiryDate,
      netAmount: t.net, gstAmount: t.gst, totalAmount: t.total, status: "DRAFT", sourceDocumentId: "",
    }, "transaction-ui");
    await batchAppend("QuoteLines", t.lines.map((line) => ({
      quoteLineId: `${quoteId}-${String(line.lineNo).padStart(3, "0")}`, quoteId, ...line,
    })), "transaction-ui");
    return { type, recordId: quoteId, documentNumber: quoteNumber, totals: t, status: "DRAFT" };
  }

  if (type === "purchaseOrder") {
    const poId = id("PO");
    const poNumber = parsed.documentNumber || poId;
    await appendRecord("PurchaseOrders", {
      poId, poNumber, supplierId: parsed.partyId, projectId: parsed.projectId,
      poDate: parsed.documentDate, netAmount: t.net, gstAmount: t.gst, totalAmount: t.total,
      status: "DRAFT", sourceDocumentId: "",
    }, "transaction-ui");
    await batchAppend("POLines", t.lines.map((line) => ({
      poLineId: `${poId}-${String(line.lineNo).padStart(3, "0")}`, poId, ...line,
    })), "transaction-ui");
    return { type, recordId: poId, documentNumber: poNumber, totals: t, status: "DRAFT" };
  }

  if (type === "invoice") {
    const invoiceId = id("INV");
    const invoiceNumber = parsed.documentNumber || invoiceId;
    await appendRecord("Invoices", {
      invoiceId, invoiceNumber, customerId: parsed.partyId, projectId: parsed.projectId,
      invoiceDate: parsed.documentDate, dueDate: parsed.dueDate,
      netAmount: t.net, gstAmount: t.gst, totalAmount: t.total,
      paidAmount: 0, outstandingAmount: t.total, status: "DRAFT", sourceDocumentId: "", journalId: "",
    }, "transaction-ui");
    await batchAppend("InvoiceLines", t.lines.map((line) => {
      const item = items.get(String(line.itemId || ""));
      return {
        invoiceLineId: `${invoiceId}-${String(line.lineNo).padStart(3, "0")}`,
        invoiceId, ...line,
        revenueAccountId: String(item?.revenueAccount || parsed.accountId || "ACC-4100"),
      };
    }), "transaction-ui");
    return { type, recordId: invoiceId, documentNumber: invoiceNumber, totals: t, status: "DRAFT" };
  }

  const billId = id("BILL");
  const billNumber = parsed.documentNumber || billId;
  await appendRecord("SupplierBills", {
    billId, billNumber, supplierId: parsed.partyId, projectId: parsed.projectId,
    billDate: parsed.documentDate, dueDate: parsed.dueDate, poId: parsed.poId,
    netAmount: t.net, gstAmount: t.gst, totalAmount: t.total,
    paidAmount: 0, outstandingAmount: t.total, status: "DRAFT", sourceDocumentId: "", journalId: "",
  }, "transaction-ui");
  await batchAppend("SupplierBillLines", t.lines.map((line) => {
    const item = items.get(String(line.itemId || ""));
    return {
      billLineId: `${billId}-${String(line.lineNo).padStart(3, "0")}`,
      billId, ...line,
      costAccountId: String(item?.costAccount || parsed.accountId || "ACC-5100"),
    };
  }), "transaction-ui");
  return { type, recordId: billId, documentNumber: billNumber, totals: t, status: "DRAFT" };
}

async function createPayment(raw: unknown) {
  const parsed = paymentSchema.parse(raw);
  if (parsed.paymentType === "RECEIVE" && parsed.partyType !== "Customer") throw new Error("Receive payments must use a Customer");
  if (parsed.paymentType === "PAY" && parsed.partyType !== "Supplier") throw new Error("Supplier payments must use a Supplier");
  await assertParty(parsed.partyType === "Customer" ? "Customers" : "Suppliers", parsed.partyType === "Customer" ? "customerId" : "supplierId", parsed.partyId);
  await assertProject(parsed.projectId);
  const paymentId = id("PAY");
  const paymentNumber = parsed.paymentNumber || paymentId;
  await appendRecord("Payments", { ...parsed, paymentId, paymentNumber, sourceDocumentId: "", journalId: "", status: "DRAFT" }, "transaction-ui");
  return { type: "payment", recordId: paymentId, documentNumber: paymentNumber, status: "DRAFT", advance: !parsed.againstDocumentId };
}

async function createExpense(raw: unknown) {
  const parsed = expenseSchema.parse(raw);
  if (parsed.supplierId) await assertParty("Suppliers", "supplierId", parsed.supplierId);
  await assertProject(parsed.projectId);
  const expenseId = id("EXP");
  const expenseNumber = parsed.expenseNumber || expenseId;
  const totalAmount = round2(parsed.netAmount + parsed.gstAmount);
  await appendRecord("Expenses", { ...parsed, expenseId, expenseNumber, totalAmount, sourceDocumentId: "", journalId: "", status: "DRAFT" }, "transaction-ui");
  return { type: "expense", recordId: expenseId, documentNumber: expenseNumber, totalAmount, status: "DRAFT" };
}

async function synchronizePaymentAllocation(row: any) {
  const againstId = String(row.againstDocumentId || "");
  if (!againstId) return;
  const receive = String(row.paymentType || "").toUpperCase() === "RECEIVE";
  const postedPayments = await findRecords<any>("Payments", { againstDocumentId: againstId, status: "POSTED" }, 500);
  const allocated = round2(postedPayments.rows
    .filter((payment: any) => receive ? String(payment.paymentType || "").toUpperCase() === "RECEIVE" : String(payment.paymentType || "").toUpperCase() === "PAY")
    .reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0));

  if (receive) {
    const invoice = (await findRecords<any>("Invoices", { invoiceId: againstId }, 1)).rows[0];
    if (!invoice) return;
    const total = Number(invoice.totalAmount || 0);
    if (allocated > total + 0.001) throw new Error("Posted customer receipts exceed invoice total; allocation review required");
    const outstandingAmount = Math.max(0, round2(total - allocated));
    await updateRecord("Invoices", "invoiceId", againstId, { paidAmount: allocated, outstandingAmount, status: outstandingAmount === 0 ? "PAID" : "POSTED" }, "finance-controller");
  } else {
    const bill = (await findRecords<any>("SupplierBills", { billId: againstId }, 1)).rows[0];
    if (!bill) return;
    const total = Number(bill.totalAmount || 0);
    if (allocated > total + 0.001) throw new Error("Posted supplier payments exceed bill total; allocation review required");
    const outstandingAmount = Math.max(0, round2(total - allocated));
    await updateRecord("SupplierBills", "billId", againstId, { paidAmount: allocated, outstandingAmount, status: outstandingAmount === 0 ? "PAID" : "POSTED" }, "finance-controller");
  }
}

async function deferredSchedulesForInvoice(row: any, invoiceLines: any[], items: Map<string, any>, policy: Record<string, number>) {
  const schedules: any[] = [];
  for (const line of invoiceLines) {
    const item = items.get(String(line.itemId || ""));
    const accountId = String(line.revenueAccountId || item?.revenueAccount || "ACC-4100");
    const periods = Number(policy[accountId] || 0);
    if (!(periods > 1) || itemType(item) === "STOCK") continue;
    const amounts = splitEvenly(Number(line.netAmount || 0), periods);
    for (let index = 0; index < periods; index += 1) {
      schedules.push({
        scheduleId: `REV-${row.invoiceId}-${String(line.lineNo || 0).padStart(3, "0")}-${String(index + 1).padStart(3, "0")}`,
        sourceType: "DEFERRED_REVENUE",
        sourceId: row.invoiceId,
        projectId: row.projectId || "",
        partyId: row.customerId || "",
        milestone: `${line.invoiceLineId}|${accountId}|${index + 1}/${periods}`,
        dueDate: addMonthsMonthEnd(String(row.invoiceDate), index),
        percentage: round4(100 / periods),
        amount: amounts[index],
        status: "PENDING",
      });
    }
  }
  return schedules;
}

async function postSalesInvoice(row: any) {
  if (["POSTED", "PAID"].includes(String(row.status || "").toUpperCase()) && String(row.journalId || "")) {
    return { recordType: "invoice", recordId: row.invoiceId, status: "already-posted", journalId: row.journalId };
  }
  if (Number(row.gstAmount || 0) > 0 && (await gstStatus()) !== "VERIFIED") {
    throw new Error("GST status is UNVERIFIED. Verify GST registration before posting GST-bearing invoices.");
  }

  await ensureAccountingInfrastructure();
  const [lineResult, itemResult, movementResult, policy] = await Promise.all([
    findRecords<any>("InvoiceLines", { invoiceId: row.invoiceId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
    deferredRevenuePolicy(),
  ]);
  if (!lineResult.rows.length) throw new Error("Invoice has no lines");
  const items = new Map(itemResult.rows.map((item: any) => [String(item.itemId || ""), item]));

  const requestedByItem = new Map<string, number>();
  for (const line of lineResult.rows) {
    const item = items.get(String(line.itemId || ""));
    if (itemType(item) === "STOCK") {
      const itemId = String(line.itemId || "");
      requestedByItem.set(itemId, (requestedByItem.get(itemId) || 0) + Number(line.qty || 0));
    }
  }

  const stateByItem = new Map<string, ReturnType<typeof inventoryState>>();
  for (const [itemId, requested] of requestedByItem.entries()) {
    const item = items.get(itemId);
    const movements = movementResult.rows.filter((movement: any) => String(movement.itemId || "") === itemId);
    const state = inventoryState(movements, Number(item?.defaultRate || 0));
    if (requested > state.qty + 0.0001) throw new Error(`Insufficient stock for ${item?.itemCode || itemId}. On hand ${state.qty}, required ${requested}`);
    stateByItem.set(itemId, state);
  }

  const existingIssues = movementResult.rows.filter((movement: any) => String(movement.sourceDocumentId || "") === String(row.invoiceId) && String(movement.movementType || "") === "SALES_ISSUE");
  const stockLines = lineResult.rows.filter((line: any) => itemType(items.get(String(line.itemId || ""))) === "STOCK");
  if (existingIssues.length && existingIssues.length !== stockLines.length) throw new Error("Partial stock issue already exists for this Sales Invoice; manual review required");

  const issueRows = stockLines.map((line: any, index: number) => {
    const itemId = String(line.itemId || "");
    const state = stateByItem.get(itemId)!;
    const value = round2(Number(line.qty || 0) * state.rate);
    return {
      movementId: `SI-STK-${row.invoiceId}-${String(index + 1).padStart(3, "0")}`,
      movementDate: String(row.invoiceDate),
      itemId,
      projectId: row.projectId || "",
      movementType: "SALES_ISSUE",
      qtyIn: 0,
      qtyOut: Number(line.qty || 0),
      unitCost: state.rate,
      value,
      sourceDocumentId: row.invoiceId,
    };
  });

  const schedules = await deferredSchedulesForInvoice(row, lineResult.rows, items, policy);
  const existingSchedules = schedules.length ? await findRecords<any>("PaymentSchedules", { sourceId: row.invoiceId, sourceType: "DEFERRED_REVENUE" }, 500) : { rows: [] as any[] };
  const existingScheduleIds = new Set(existingSchedules.rows.map((schedule: any) => String(schedule.scheduleId || "")));
  const schedulesToCreate = schedules.filter((schedule) => !existingScheduleIds.has(schedule.scheduleId));
  if (schedulesToCreate.length) await batchAppend("PaymentSchedules", schedulesToCreate, "deferred-revenue-schedule");

  let createdIssues = false;
  try {
    if (!existingIssues.length && issueRows.length) {
      await batchAppend("StockMovements", issueRows, "sales-invoice-stock");
      createdIssues = true;
    }

    const revenueLines = lineResult.rows.map((line: any) => {
      const item = items.get(String(line.itemId || ""));
      const accountId = String(line.revenueAccountId || item?.revenueAccount || "ACC-4100");
      return {
        accountId,
        amount: Number(line.netAmount || 0),
        description: String(line.description || "Sales revenue"),
        deferred: itemType(item) !== "STOCK" && Number(policy[accountId] || 0) > 1,
      };
    });
    const cogsLines = stockLines.map((line: any) => {
      const item = items.get(String(line.itemId || ""));
      const state = stateByItem.get(String(line.itemId || ""))!;
      return {
        accountId: String(item?.costAccount || "ACC-5100"),
        amount: round2(Number(line.qty || 0) * state.rate),
        description: String(line.description || "Cost of goods sold"),
      };
    });

    const journal = await postJournal({
      postingDate: String(row.invoiceDate), documentType: "SALES_INVOICE", documentId: row.invoiceId,
      documentNumber: row.invoiceNumber, reference: `Sales invoice ${row.invoiceNumber}`, projectId: row.projectId,
      lines: salesInvoicePostingByLines({
        total: Number(row.totalAmount), gst: Number(row.gstAmount), customerId: row.customerId,
        projectId: row.projectId, revenueLines, cogsLines,
      }),
    });

    await updateRecord("Invoices", "invoiceId", row.invoiceId, { status: "POSTED", journalId: journal.journalId }, "finance-controller");
    return { recordType: "invoice", recordId: row.invoiceId, status: "POSTED", journalId: journal.journalId, stockLines: issueRows.length, deferredSchedules: schedules.length };
  } catch (error) {
    if (createdIssues && issueRows.length) {
      const rollback = issueRows.map((issue: any, index: number) => ({
        movementId: `RB-${issue.movementId}-${String(index + 1).padStart(2, "0")}`,
        movementDate: issue.movementDate, itemId: issue.itemId, projectId: issue.projectId,
        movementType: "SALES_ISSUE_ROLLBACK", qtyIn: issue.qtyOut, qtyOut: 0,
        unitCost: issue.unitCost, value: issue.value, sourceDocumentId: row.invoiceId,
      }));
      try { await batchAppend("StockMovements", rollback, "sales-invoice-stock-rollback"); } catch { /* audit trail remains in Exceptions below */ }
    }
    for (const schedule of schedulesToCreate) {
      try { await updateRecord("PaymentSchedules", "scheduleId", schedule.scheduleId, { status: "CANCELLED" }, "sales-invoice-posting-rollback"); } catch { /* best effort */ }
    }
    try {
      await appendRecord("Exceptions", {
        severity: "HIGH", module: "Accounting", recordType: "Sales Invoice", recordId: row.invoiceId,
        message: error instanceof Error ? error.message : "Sales Invoice posting failed", status: "OPEN", assignedTo: "Finance Controller",
      }, "sales-invoice-posting");
    } catch { /* best effort */ }
    throw error;
  }
}

async function postSupplierBill(row: any) {
  if (["POSTED", "PAID"].includes(String(row.status || "").toUpperCase()) && String(row.journalId || "")) {
    return { recordType: "supplierBill", recordId: row.billId, status: "already-posted", journalId: row.journalId };
  }
  if (Number(row.gstAmount || 0) > 0 && (await gstStatus()) !== "VERIFIED") {
    throw new Error("GST status is UNVERIFIED. Verify GST registration before posting input GST.");
  }

  await ensureAccountingInfrastructure();
  const [lineResult, itemResult, tolerance] = await Promise.all([
    findRecords<any>("SupplierBillLines", { billId: row.billId }, 500),
    listTable<any>("Items", 500, 0),
    purchasePriceVarianceTolerancePct(),
  ]);
  if (!lineResult.rows.length) throw new Error("Supplier bill has no lines");
  const items = new Map(itemResult.rows.map((item: any) => [String(item.itemId || ""), item]));

  if (!row.poId) {
    const stockLine = lineResult.rows.find((line: any) => itemType(items.get(String(line.itemId || ""))) === "STOCK");
    if (stockLine) throw new Error("Stock Supplier Invoices require an approved Purchase Order and Purchase Receipt");
    const journal = await postJournal({
      postingDate: String(row.billDate), documentType: "SUPPLIER_BILL", documentId: row.billId,
      documentNumber: row.billNumber, reference: `Supplier bill ${row.billNumber}`, projectId: row.projectId,
      lines: supplierBillPostingByLines({
        total: Number(row.totalAmount), gst: Number(row.gstAmount), supplierId: row.supplierId, projectId: row.projectId,
        costLines: lineResult.rows.map((line: any) => ({ accountId: String(line.costAccountId || items.get(String(line.itemId || ""))?.costAccount || "ACC-5100"), amount: Number(line.netAmount || 0), description: String(line.description || "Supplier cost") })),
      }),
    });
    await updateRecord("SupplierBills", "billId", row.billId, { status: "POSTED", journalId: journal.journalId }, "finance-controller");
    return { recordType: "supplierBill", recordId: row.billId, status: "POSTED", journalId: journal.journalId };
  }

  const [poResult, poLinesResult, receiptResult, poBillsResult, allBillLines] = await Promise.all([
    findRecords<any>("PurchaseOrders", { poId: row.poId }, 1),
    findRecords<any>("POLines", { poId: row.poId }, 500),
    findRecords<any>("StockMovements", { sourceDocumentId: row.poId }, 500),
    findRecords<any>("SupplierBills", { poId: row.poId }, 500),
    listTable<any>("SupplierBillLines", 500, 0),
  ]);
  const po = poResult.rows[0];
  if (!po) throw new Error("Referenced Purchase Order not found");
  if (String(po.supplierId || "") !== String(row.supplierId || "")) throw new Error("Supplier Invoice supplier does not match the Purchase Order");
  if (String(po.projectId || "") !== String(row.projectId || "")) throw new Error("Supplier Invoice project does not match the Purchase Order");

  const priorBillIds = new Set(poBillsResult.rows
    .filter((bill: any) => String(bill.billId || "") !== String(row.billId) && !["CANCELLED", "REVERSED"].includes(String(bill.status || "").toUpperCase()))
    .map((bill: any) => String(bill.billId || "")));

  const previouslyBilledByItem = new Map<string, number>();
  for (const line of allBillLines.rows) {
    if (!priorBillIds.has(String(line.billId || ""))) continue;
    const itemId = String(line.itemId || "");
    previouslyBilledByItem.set(itemId, (previouslyBilledByItem.get(itemId) || 0) + Number(line.qty || 0));
  }

  const serviceCostLines: Array<{ accountId: string; amount: number; description?: string }> = [];
  const stockLines: Array<{ invoiceAmount: number; receiptValue: number; description?: string }> = [];

  for (const line of lineResult.rows) {
    const itemId = String(line.itemId || "");
    const item = items.get(itemId);
    if (!item) throw new Error(`Supplier Invoice item not found in Item Master: ${itemId}`);
    const matchingPoLines = poLinesResult.rows.filter((poLine: any) => String(poLine.itemId || "") === itemId);
    if (!matchingPoLines.length) throw new Error(`Supplier Invoice item is not on the Purchase Order: ${item.itemCode || itemId}`);

    const orderedQty = matchingPoLines.reduce((sum: number, poLine: any) => sum + Number(poLine.qty || 0), 0);
    const poRate = weightedRate(matchingPoLines);
    const priorBilled = Number(previouslyBilledByItem.get(itemId) || 0);
    const currentQty = Number(line.qty || 0);
    const rateVariancePct = poRate > 0 ? Math.abs(Number(line.rate || 0) - poRate) / poRate * 100 : 0;
    if (rateVariancePct > tolerance + 0.0001) {
      throw new Error(`Purchase price variance exceeds ${tolerance}% tolerance for ${item.itemCode || itemId}. PO rate ${poRate.toFixed(2)}, invoice rate ${Number(line.rate || 0).toFixed(2)}`);
    }

    if (itemType(item) === "STOCK") {
      const receipts = receiptResult.rows.filter((movement: any) => String(movement.itemId || "") === itemId && String(movement.movementType || "") === "PURCHASE_RECEIPT");
      const receivedQty = receipts.reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
      const availableToBill = Math.max(0, receivedQty - priorBilled);
      if (currentQty > availableToBill + 0.0001) {
        throw new Error(`Three-way match failed for ${item.itemCode || itemId}: ordered ${orderedQty}, received ${receivedQty}, previously billed ${priorBilled}, invoice qty ${currentQty}`);
      }
      const receiptRate = receivedQty > 0
        ? receipts.reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0) * Number(movement.unitCost || 0), 0) / receivedQty
        : 0;
      stockLines.push({ invoiceAmount: Number(line.netAmount || 0), receiptValue: round2(currentQty * receiptRate), description: String(line.description || item.itemName || itemId) });
    } else {
      const availableToBill = Math.max(0, orderedQty - priorBilled);
      if (currentQty > availableToBill + 0.0001) throw new Error(`Supplier Invoice quantity exceeds remaining PO quantity for ${item.itemCode || itemId}`);
      serviceCostLines.push({ accountId: String(line.costAccountId || item.costAccount || "ACC-5200"), amount: Number(line.netAmount || 0), description: String(line.description || item.itemName || itemId) });
    }
  }

  const mixed = supplierBillPostingMixed({
    total: Number(row.totalAmount), gst: Number(row.gstAmount), supplierId: row.supplierId, projectId: row.projectId,
    serviceCostLines, stockLines,
  });
  const journal = await postJournal({
    postingDate: String(row.billDate), documentType: "SUPPLIER_BILL", documentId: row.billId,
    documentNumber: row.billNumber, reference: `Supplier bill ${row.billNumber}`, projectId: row.projectId,
    lines: mixed.lines,
  });
  await updateRecord("SupplierBills", "billId", row.billId, { status: "POSTED", journalId: journal.journalId }, "finance-controller");

  const currentBillQty = new Map<string, number>();
  for (const line of lineResult.rows) currentBillQty.set(String(line.itemId || ""), (currentBillQty.get(String(line.itemId || "")) || 0) + Number(line.qty || 0));
  const fullyBilled = poLinesResult.rows.every((poLine: any) => {
    const itemId = String(poLine.itemId || "");
    const totalOrdered = poLinesResult.rows.filter((candidate: any) => String(candidate.itemId || "") === itemId).reduce((sum: number, candidate: any) => sum + Number(candidate.qty || 0), 0);
    return Number(previouslyBilledByItem.get(itemId) || 0) + Number(currentBillQty.get(itemId) || 0) + 0.0001 >= totalOrdered;
  });
  await updateRecord("PurchaseOrders", "poId", row.poId, { status: fullyBilled ? "BILLED" : "PART_BILLED" }, "finance-controller");

  return {
    recordType: "supplierBill", recordId: row.billId, status: "POSTED", journalId: journal.journalId,
    purchasePriceVariance: mixed.purchasePriceVariance, grniCleared: mixed.receiptValue,
  };
}

async function postPayment(row: any) {
  if (String(row.status || "").toUpperCase() === "POSTED" && String(row.journalId || "")) {
    await synchronizePaymentAllocation(row);
    return { recordType: "payment", recordId: row.paymentId, status: "already-posted", journalId: row.journalId };
  }
  await ensureAccountingInfrastructure();
  const receive = String(row.paymentType || "").toUpperCase() === "RECEIVE";
  const advance = !String(row.againstDocumentId || "").trim();

  if (!advance) {
    if (receive) {
      const invoice = (await findRecords<any>("Invoices", { invoiceId: row.againstDocumentId }, 1)).rows[0];
      if (!invoice) throw new Error("Against invoice not found");
      if (String(invoice.customerId) !== String(row.partyId)) throw new Error("Payment customer does not match the against invoice");
      if (!["POSTED", "PAID"].includes(String(invoice.status).toUpperCase())) throw new Error("Customer receipt can only be allocated against a posted invoice");
      if (Number(row.amount) > Number(invoice.outstandingAmount || 0) + 0.001) throw new Error("Customer receipt exceeds invoice outstanding amount");
    } else {
      const bill = (await findRecords<any>("SupplierBills", { billId: row.againstDocumentId }, 1)).rows[0];
      if (!bill) throw new Error("Against supplier bill not found");
      if (String(bill.supplierId) !== String(row.partyId)) throw new Error("Payment supplier does not match the against supplier bill");
      if (!["POSTED", "PAID"].includes(String(bill.status).toUpperCase())) throw new Error("Supplier payment can only be allocated against a posted supplier bill");
      if (Number(row.amount) > Number(bill.outstandingAmount || 0) + 0.001) throw new Error("Supplier payment exceeds bill outstanding amount");
    }
  }

  const lines = receive
    ? receiptPosting({ amount: Number(row.amount), customerId: row.partyId, projectId: row.projectId, cashBankAccountId: row.cashBankAccountId, advance })
    : supplierPaymentPosting({ amount: Number(row.amount), supplierId: row.partyId, projectId: row.projectId, cashBankAccountId: row.cashBankAccountId, advance });

  const journal = await postJournal({
    postingDate: String(row.paymentDate), documentType: advance ? (receive ? "CUSTOMER_ADVANCE" : "SUPPLIER_ADVANCE") : (receive ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT"),
    documentId: row.paymentId, documentNumber: row.paymentNumber, reference: row.reference || row.paymentNumber,
    projectId: row.projectId, lines,
  });
  await updateRecord("Payments", "paymentId", row.paymentId, { status: "POSTED", journalId: journal.journalId }, "finance-controller");
  if (!advance) await synchronizePaymentAllocation({ ...row, status: "POSTED" });
  return { recordType: "payment", recordId: row.paymentId, status: "POSTED", journalId: journal.journalId, advance };
}

async function allocateAdvance(raw: unknown) {
  const input = allocateAdvanceSchema.parse(raw);
  const payment = (await findRecords<any>("Payments", { paymentId: input.paymentId }, 1)).rows[0];
  if (!payment) throw new Error("Advance Payment Entry not found");
  if (String(payment.status || "").toUpperCase() !== "POSTED" || !String(payment.journalId || "")) throw new Error("Advance Payment Entry must be finalized before allocation");
  if (String(payment.againstDocumentId || "").trim()) throw new Error("This advance is already allocated");
  await ensureAccountingInfrastructure();

  const customer = String(payment.partyType || "") === "Customer";
  if (customer && input.againstDocumentType !== "Sales Invoice") throw new Error("Customer advances can only be allocated to Sales Invoices");
  if (!customer && input.againstDocumentType !== "Supplier Invoice") throw new Error("Supplier advances can only be allocated to Supplier Invoices");

  const source = customer
    ? (await findRecords<any>("Invoices", { invoiceId: input.againstDocumentId }, 1)).rows[0]
    : (await findRecords<any>("SupplierBills", { billId: input.againstDocumentId }, 1)).rows[0];
  if (!source) throw new Error(`${input.againstDocumentType} not found`);
  if (customer && String(source.customerId || "") !== String(payment.partyId || "")) throw new Error("Advance customer does not match Sales Invoice customer");
  if (!customer && String(source.supplierId || "") !== String(payment.partyId || "")) throw new Error("Advance supplier does not match Supplier Invoice supplier");
  const outstanding = Number(source.outstandingAmount || 0);
  if (Number(payment.amount || 0) > outstanding + 0.001) throw new Error("Full advance allocation exceeds document outstanding amount; split allocation requires a dedicated reconciliation entry");

  const amount = Number(payment.amount || 0);
  const allocationLines = customer
    ? [
        { accountId: "ACC-2150", debit: amount, customerId: payment.partyId, projectId: payment.projectId, description: "Apply customer advance" },
        { accountId: "ACC-1130", credit: amount, customerId: payment.partyId, projectId: payment.projectId, description: "Settle Accounts Receivable from advance" },
      ]
    : [
        { accountId: "ACC-2110", debit: amount, supplierId: payment.partyId, projectId: payment.projectId, description: "Settle Accounts Payable from advance" },
        { accountId: "ACC-1160", credit: amount, supplierId: payment.partyId, projectId: payment.projectId, description: "Apply supplier advance" },
      ];

  const journal = await postJournal({
    postingDate: String(payment.paymentDate), documentType: customer ? "CUSTOMER_ADVANCE_ALLOCATION" : "SUPPLIER_ADVANCE_ALLOCATION",
    documentId: `${payment.paymentId}-${input.againstDocumentId}`, documentNumber: payment.paymentNumber,
    reference: `Allocate ${payment.paymentNumber} to ${input.againstDocumentId}`, projectId: payment.projectId, lines: allocationLines,
  });
  await updateRecord("Payments", "paymentId", payment.paymentId, { againstDocumentType: input.againstDocumentType, againstDocumentId: input.againstDocumentId, sourceDocumentId: input.againstDocumentId }, "advance-allocation");
  await synchronizePaymentAllocation({ ...payment, againstDocumentType: input.againstDocumentType, againstDocumentId: input.againstDocumentId, status: "POSTED" });
  return { paymentId: payment.paymentId, againstDocumentId: input.againstDocumentId, journalId: journal.journalId, allocatedAmount: amount };
}

async function postRecord(raw: unknown) {
  const parsed = postSchema.parse(raw);
  if (parsed.recordType === "invoice") {
    const row = (await findRecords<any>("Invoices", { invoiceId: parsed.recordId }, 1)).rows[0];
    if (!row) throw new Error("Invoice not found");
    return postSalesInvoice(row);
  }
  if (parsed.recordType === "supplierBill") {
    const row = (await findRecords<any>("SupplierBills", { billId: parsed.recordId }, 1)).rows[0];
    if (!row) throw new Error("Supplier bill not found");
    return postSupplierBill(row);
  }
  if (parsed.recordType === "payment") {
    const row = (await findRecords<any>("Payments", { paymentId: parsed.recordId }, 1)).rows[0];
    if (!row) throw new Error("Payment not found");
    return postPayment(row);
  }

  const row = (await findRecords<any>("Expenses", { expenseId: parsed.recordId }, 1)).rows[0];
  if (!row) throw new Error("Expense not found");
  if (String(row.status || "").toUpperCase() === "POSTED" && String(row.journalId || "")) {
    return { recordType: parsed.recordType, recordId: parsed.recordId, status: "already-posted", journalId: row.journalId };
  }
  if (Number(row.gstAmount || 0) > 0 && (await gstStatus()) !== "VERIFIED") throw new Error("GST status is UNVERIFIED. Verify GST registration before posting input GST.");
  await ensureAccountingInfrastructure();
  const journal = await postJournal({
    postingDate: String(row.expenseDate), documentType: "EXPENSE", documentId: row.expenseId,
    documentNumber: row.expenseNumber, reference: row.description, projectId: row.projectId,
    lines: expensePosting({
      total: Number(row.totalAmount), net: Number(row.netAmount), gst: Number(row.gstAmount),
      supplierId: row.supplierId, projectId: row.projectId, expenseAccountId: row.expenseAccountId,
      cashBankAccountId: row.cashBankAccountId,
    }),
  });
  await updateRecord("Expenses", "expenseId", row.expenseId, { status: "POSTED", journalId: journal.journalId }, "finance-controller");
  return { recordType: parsed.recordType, recordId: row.expenseId, status: "POSTED", journalId: journal.journalId };
}

export async function GET() {
  try {
    const [quotes, purchaseOrders, invoices, supplierBills, payments, expenses] = await Promise.all([
      listTable("Quotes", 500, 0), listTable("PurchaseOrders", 500, 0), listTable("Invoices", 500, 0),
      listTable("SupplierBills", 500, 0), listTable("Payments", 500, 0), listTable("Expenses", 500, 0),
    ]);
    return NextResponse.json({ ok: true, quotes: quotes.rows, purchaseOrders: purchaseOrders.rows, invoices: invoices.rows, supplierBills: supplierBills.rows, payments: payments.rows, expenses: expenses.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Transaction read failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { secret?: string; action?: string; payload?: unknown };
    requireSecret(body.secret);
    let result: unknown;
    if (body.action === "createQuote") result = await createCommercial("quote", body.payload);
    else if (body.action === "createPurchaseOrder") result = await createCommercial("purchaseOrder", body.payload);
    else if (body.action === "createInvoice") result = await createCommercial("invoice", body.payload);
    else if (body.action === "createSupplierBill") result = await createCommercial("supplierBill", body.payload);
    else if (body.action === "createPayment") result = await createPayment(body.payload);
    else if (body.action === "createExpense") result = await createExpense(body.payload);
    else if (body.action === "post") result = await postRecord(body.payload);
    else if (body.action === "allocateAdvance") result = await allocateAdvance(body.payload);
    else throw new Error("Unsupported transaction action");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Transaction failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
