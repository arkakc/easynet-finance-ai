import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission, hasPermission, type Permission } from "@/lib/auth";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { resolveTransactionItems } from "@/lib/erp/item-linking";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/transactions/route";
import { postJournal, receiptPosting, supplierPaymentPosting } from "@/lib/accounting/posting";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import { synchronizeSettlement } from "@/lib/accounting/advance-allocation";
import { round2 } from "@/lib/accounting/inventory";

const ACTION_PERMISSION: Record<string, Permission> = {
  createQuote: "sales.write",
  createInvoice: "sales.write",
  createSupplierQuote: "purchase.write",
  createPurchaseOrder: "purchase.write",
  createSupplierBill: "purchase.write",
  createExpense: "purchase.write",
};

const SERIES: Record<string, { table: string; field: string; prefix: string; payloadField: string }> = {
  createQuote: { table: "Quotes", field: "quoteNumber", prefix: "SQ", payloadField: "documentNumber" },
  createInvoice: { table: "Invoices", field: "invoiceNumber", prefix: "SI", payloadField: "documentNumber" },
  createSupplierQuote: { table: "PurchaseOrders", field: "poNumber", prefix: "SUPQ", payloadField: "documentNumber" },
  createPurchaseOrder: { table: "PurchaseOrders", field: "poNumber", prefix: "PO", payloadField: "documentNumber" },
  createSupplierBill: { table: "SupplierBills", field: "billNumber", prefix: "PB", payloadField: "documentNumber" },
  createPayment: { table: "Payments", field: "paymentNumber", prefix: "PE", payloadField: "paymentNumber" },
  createExpense: { table: "Expenses", field: "expenseNumber", prefix: "EXP", payloadField: "expenseNumber" },
};

const CASH_BANK_IDS = new Set(["ACC-1110", "ACC-1120", "ACC-1121"]);

function pngYear() { return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date()); }
async function nextNumber(action: string) {
  const config = SERIES[action];
  if (!config) return "";
  const prefix = `${config.prefix}-${pngYear()}-`;
  const rows = await listTable<any>(config.table, 500, 0);
  const max = rows.rows.reduce((current, row) => {
    const value = String(row[config.field] || "");
    if (!value.startsWith(prefix)) return current;
    const sequence = Number(value.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > current ? sequence : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}
function permissionForAction(action: string, partyType?: string): Permission | undefined {
  if (action === "createPayment" || action === "finalizePayment" || action === "allocateAdvance") return partyType === "Supplier" ? "purchase.write" : "sales.write";
  return ACTION_PERMISSION[action];
}

async function cashBankAvailability(accountId: string) {
  if (!CASH_BANK_IDS.has(accountId)) throw new Error("Select a valid Cash / Bank account from the controlled account list");
  const [accountResult, lineResult] = await Promise.all([
    findRecords<any>("Accounts", { accountId }, 1),
    listTable<any>("JournalLines", 500, 0),
  ]);
  const account = accountResult.rows[0];
  if (!account) throw new Error("Cash / Bank account does not exist");
  if (["false", "0", "inactive"].includes(String(account.active ?? "true").toLowerCase())) throw new Error("Cash / Bank account is inactive");
  const balance = (lineResult.rows || [])
    .filter((line: any) => String(line.accountId || "") === accountId)
    .reduce((sum: number, line: any) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0);
  return {
    balance: Math.round((balance + Number.EPSILON) * 100) / 100,
    label: `${String(account.accountName || accountId)} (${accountId})`,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const nextAction = url.searchParams.get("nextNumberFor") || "";
    if (nextAction) {
      const partyType = url.searchParams.get("partyType") || undefined;
      const permission = permissionForAction(nextAction, partyType);
      if (!permission || !SERIES[nextAction]) return NextResponse.json({ ok: false, error: "Unsupported document type" }, { status: 400 });
      await requirePermission(permission);
      return NextResponse.json({ ok: true, action: nextAction, nextNumber: await nextNumber(nextAction) });
    }

    const user = await requirePermission("dashboard.read");
    const response = await legacyGet();
    const body = await response.json();
    if (!body.ok) return NextResponse.json(body, { status: response.status });
    const canSales = hasPermission(user, "sales.read"), canPurchase = hasPermission(user, "purchase.read"), canAccounts = hasPermission(user, "accounts.read");
    const allPurchaseOrders = Array.isArray(body.purchaseOrders) ? body.purchaseOrders : [];
    const supplierQuotes = canPurchase ? allPurchaseOrders.filter((row: any) => String(row.poNumber || "").startsWith("SUPQ-")) : [];
    const purchaseOrders = canPurchase ? allPurchaseOrders.filter((row: any) => !String(row.poNumber || "").startsWith("SUPQ-")) : [];
    const payments = Array.isArray(body.payments) ? body.payments.filter((row: any) => {
      if (canAccounts) return true;
      if (String(row.partyType || "") === "Customer") return canSales;
      if (String(row.partyType || "") === "Supplier") return canPurchase;
      return false;
    }) : [];
    return NextResponse.json({ ...body, quotes: canSales ? body.quotes || [] : [], invoices: canSales ? body.invoices || [] : [], supplierQuotes, purchaseOrders, supplierBills: canPurchase ? body.supplierBills || [] : [], expenses: canPurchase ? body.expenses || [] : [], payments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : 401 });
  }
}

async function callLegacy(action: string, payload: Record<string, unknown>) {
  if (!env.APP_SECRET) throw new Error("Server compatibility credential is not configured");
  const internal = new Request("http://internal/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload, secret: env.APP_SECRET }),
  });
  const response = await legacyPost(internal);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "Accounting action failed");
  return body.result;
}

async function creditNoteRefundable(creditNoteId: string, currentPaymentId: string) {
  const [creditNoteResult, journalResult, linesResult, paymentsResult] = await Promise.all([
    findRecords<any>("Invoices", { invoiceId: creditNoteId }, 1),
    findRecords<any>("JournalHeaders", { documentType: "SALES_CREDIT_NOTE", documentId: creditNoteId }, 20),
    listTable<any>("JournalLines", 500, 0),
    findRecords<any>("Payments", { sourceDocumentId: creditNoteId }, 500),
  ]);
  const creditNote = creditNoteResult.rows[0];
  if (!creditNote || !String(creditNote.invoiceNumber || "").toUpperCase().startsWith("CN-") || String(creditNote.status || "").toUpperCase() !== "POSTED") {
    throw new Error("Posted Sales Credit Note not found for customer refund");
  }
  const journalIds = new Set((journalResult.rows || []).filter((row: any) => String(row.status || "").toUpperCase() === "POSTED").map((row: any) => String(row.journalId || "")));
  const customerCredit = round2((linesResult.rows || [])
    .filter((line: any) => journalIds.has(String(line.journalId || "")) && String(line.accountId || "") === "ACC-2150")
    .reduce((sum: number, line: any) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
  const priorRefunds = round2((paymentsResult.rows || [])
    .filter((row: any) => String(row.paymentId || "") !== currentPaymentId
      && String(row.partyType || "") === "Customer"
      && String(row.paymentType || "").toUpperCase() === "PAY"
      && String(row.status || "").toUpperCase() === "POSTED"
      && Boolean(row.journalId))
    .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
  return { creditNote, refundable: round2(Math.max(0, customerCredit - priorRefunds)) };
}

async function finalizeCustomerRefund(row: any, patch: { paymentDate: string; amount: number; paymentMethod: string; cashBankAccountId: string; reference: string }) {
  const creditNoteId = String(row.sourceDocumentId || row.againstDocumentId || "").trim();
  if (!creditNoteId || !String(row.reference || "").startsWith("CUSTOMER_REFUND|")) throw new Error("Customer PAY entries are allowed only through the controlled Sales Credit Note refund workflow");
  const refundable = await creditNoteRefundable(creditNoteId, String(row.paymentId || ""));
  if (String(refundable.creditNote.customerId || "") !== String(row.partyId || "")) throw new Error("Refund customer does not match Sales Credit Note customer");
  if (patch.amount > refundable.refundable + 0.001) throw new Error(`Refund exceeds remaining refundable customer credit. Available K${refundable.refundable.toFixed(2)}`);

  await updateRecord("Payments", "paymentId", row.paymentId, patch, "payment-final-save:customer-refund");
  const journal = await postJournal({
    postingDate: patch.paymentDate,
    documentType: "CUSTOMER_REFUND",
    documentId: row.paymentId,
    documentNumber: String(row.paymentNumber || row.paymentId),
    reference: patch.reference || `Customer refund against ${refundable.creditNote.invoiceNumber}`,
    projectId: row.projectId || "",
    lines: [
      { accountId: "ACC-2150", debit: patch.amount, customerId: row.partyId, projectId: row.projectId, description: "Refund customer credit / advance" },
      { accountId: patch.cashBankAccountId, credit: patch.amount, customerId: row.partyId, projectId: row.projectId, description: "Customer refund paid" },
    ],
  });
  await updateRecord("Payments", "paymentId", row.paymentId, { status: "POSTED", journalId: journal.journalId }, "payment-final-save:customer-refund");
  return { recordId: row.paymentId, status: "POSTED", journalId: journal.journalId, refund: true, creditNoteId };
}

async function finalizeStandardPayment(row: any, patch: { paymentDate: string; amount: number; paymentMethod: string; cashBankAccountId: string; reference: string }) {
  await ensureAccountingInfrastructure();
  const receive = String(row.paymentType || "").toUpperCase() === "RECEIVE";
  const partyType = String(row.partyType || "");
  if (receive && partyType !== "Customer") throw new Error("Receive payments must use a Customer");
  if (!receive && partyType !== "Supplier") throw new Error("Supplier payments must use a Supplier");

  const againstDocumentId = String(row.againstDocumentId || "").trim();
  const advance = !againstDocumentId;
  if (!advance) {
    if (receive) {
      const invoice = (await findRecords<any>("Invoices", { invoiceId: againstDocumentId }, 1)).rows[0];
      if (!invoice) throw new Error("Against Sales Invoice not found");
      if (String(invoice.customerId || "") !== String(row.partyId || "")) throw new Error("Payment customer does not match the Sales Invoice customer");
      if (!["POSTED", "PARTLY_PAID", "PAID"].includes(String(invoice.status || "").toUpperCase())) throw new Error("Customer receipt can only be allocated against a posted Sales Invoice");
      if (patch.amount > Number(invoice.outstandingAmount || 0) + 0.001) throw new Error("Customer receipt exceeds Sales Invoice outstanding amount");
      if (String(row.againstDocumentType || "") && !String(row.againstDocumentType || "").toLowerCase().includes("sales invoice")) throw new Error("Customer receipt has an invalid against-document type");
    } else {
      const bill = (await findRecords<any>("SupplierBills", { billId: againstDocumentId }, 1)).rows[0];
      if (!bill) throw new Error("Against Supplier Invoice not found");
      if (String(bill.supplierId || "") !== String(row.partyId || "")) throw new Error("Payment supplier does not match the Supplier Invoice supplier");
      if (!["POSTED", "PARTLY_PAID", "PAID"].includes(String(bill.status || "").toUpperCase())) throw new Error("Supplier payment can only be allocated against a posted Supplier Invoice");
      if (patch.amount > Number(bill.outstandingAmount || 0) + 0.001) throw new Error("Supplier payment exceeds Supplier Invoice outstanding amount");
      const againstType = String(row.againstDocumentType || "").toLowerCase();
      if (againstType && !againstType.includes("supplier invoice") && !againstType.includes("supplier bill")) throw new Error("Supplier payment has an invalid against-document type");
    }
  }

  const lines = receive
    ? receiptPosting({ amount: patch.amount, customerId: row.partyId, projectId: row.projectId, cashBankAccountId: patch.cashBankAccountId, advance })
    : supplierPaymentPosting({ amount: patch.amount, supplierId: row.partyId, projectId: row.projectId, cashBankAccountId: patch.cashBankAccountId, advance });
  const journal = await postJournal({
    postingDate: patch.paymentDate,
    documentType: advance ? (receive ? "CUSTOMER_ADVANCE" : "SUPPLIER_ADVANCE") : (receive ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT"),
    documentId: row.paymentId,
    documentNumber: String(row.paymentNumber || row.paymentId),
    reference: patch.reference || String(row.reference || row.paymentNumber || row.paymentId),
    projectId: row.projectId || "",
    lines,
  });
  await updateRecord("Payments", "paymentId", row.paymentId, { ...patch, status: "POSTED", journalId: journal.journalId }, "payment-final-save:standard");
  if (!advance) await synchronizeSettlement(receive ? "Customer" : "Supplier", againstDocumentId);
  return { recordId: row.paymentId, status: "POSTED", journalId: journal.journalId, advance, finalized: true };
}

async function finalizePayment(payload: Record<string, unknown>) {
  const paymentId = String(payload.paymentId || "").trim();
  if (!paymentId) throw new Error("Payment Entry is required");
  const row = (await findRecords<any>("Payments", { paymentId }, 1)).rows[0];
  if (!row) throw new Error("Payment Entry not found");
  const partyType = String(row.partyType || "");
  await requirePermission(partyType === "Supplier" ? "purchase.write" : "sales.write");

  if (String(row.journalId || "").trim()) {
    return { recordId: paymentId, status: String(row.status || "POSTED"), journalId: row.journalId, alreadyFinalized: true };
  }
  if (String(row.status || "").toUpperCase() !== "APPROVED") throw new Error("Payment Entry must be APPROVED before Final Save");

  const amount = Number(payload.amount ?? row.amount ?? 0);
  if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
  const patch = {
    paymentDate: String(payload.paymentDate ?? row.paymentDate ?? ""),
    amount,
    paymentMethod: String(payload.paymentMethod ?? row.paymentMethod ?? ""),
    cashBankAccountId: String(payload.cashBankAccountId ?? row.cashBankAccountId ?? ""),
    reference: String(payload.reference ?? row.reference ?? ""),
  };
  if (!patch.paymentDate) throw new Error("Payment Date is required");
  if (!patch.paymentMethod) throw new Error("Payment Method is required");
  if (!patch.cashBankAccountId) throw new Error("Cash / Bank Account is required");

  const pay = String(row.paymentType || "").toUpperCase() === "PAY";
  if (pay) {
    const funds = await cashBankAvailability(patch.cashBankAccountId);
    if (amount > funds.balance + 0.001) {
      throw new Error(`Insufficient funds in ${funds.label}. Available K${funds.balance.toFixed(2)}, payment K${amount.toFixed(2)}. Record funding/opening balance first or use a valid funded account.`);
    }
  } else {
    // Receipts may increase a valid controlled cash/bank account from zero.
    await cashBankAvailability(patch.cashBankAccountId);
  }

  if (partyType === "Customer" && pay) {
    return finalizeCustomerRefund(row, patch);
  }

  return finalizeStandardPayment(row, patch);
}

async function allocateAdvance(payload: Record<string, unknown>) {
  const paymentId = String(payload.paymentId || "").trim();
  if (!paymentId) throw new Error("Advance Payment Entry is required");
  const row = (await findRecords<any>("Payments", { paymentId }, 1)).rows[0];
  if (!row) throw new Error("Advance Payment Entry not found");
  const partyType = String(row.partyType || "");
  await requirePermission(partyType === "Supplier" ? "purchase.write" : "sales.write");
  return callLegacy("allocateAdvance", payload);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; payload?: Record<string, unknown> };
    if (body.action === "post") return NextResponse.json({ ok: false, error: "Use document approval for invoices/expenses or Final Save for Payment Entries." }, { status: 400 });
    if (body.action === "finalizePayment") return NextResponse.json({ ok: true, result: await finalizePayment(body.payload || {}) });
    if (body.action === "allocateAdvance") return NextResponse.json({ ok: true, result: await allocateAdvance(body.payload || {}) });

    const permission = body.action ? permissionForAction(body.action, String(body.payload?.partyType || "")) : undefined;
    if (!permission) return NextResponse.json({ ok: false, error: "Unsupported transaction action" }, { status: 400 });
    await requirePermission(permission);
    if (!env.APP_SECRET) throw new Error("Server compatibility credential is not configured");

    let payload = body.payload || {};
    const series = body.action ? SERIES[body.action] : undefined;
    if (body.action && series && !String(payload[series.payloadField] || "").trim()) payload = { ...payload, [series.payloadField]: await nextNumber(body.action) };

    let itemLinking: { created: number; linked: number; temporary: number } | undefined;
    if (body.action && ["createQuote", "createInvoice", "createSupplierQuote", "createPurchaseOrder"].includes(body.action)) {
      const rawLines = Array.isArray(payload.lines) ? payload.lines as any[] : [];
      const temporaryQuotation = body.action === "createSupplierQuote" || body.action === "createQuote";
      const resolved = await resolveTransactionItems(rawLines, {
        allowTemporary: temporaryQuotation,
        autoCreateMissing: !temporaryQuotation,
        actor: `transaction-${body.action}`,
        defaultNewItemType: "STOCK",
      });
      payload = { ...payload, lines: resolved.lines };
      itemLinking = { created: resolved.createdItems.length, linked: resolved.linkedCount, temporary: resolved.temporaryCount };
    }

    const legacyAction = body.action === "createSupplierQuote" ? "createPurchaseOrder" : body.action!;
    const result = await callLegacy(legacyAction, payload);
    if (body.action === "createSupplierQuote" && result) result.type = "supplierQuote";
    if (result && itemLinking) result.itemLinking = itemLinking;
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
