import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission, hasPermission, type Permission } from "@/lib/auth";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { resolveTransactionItems } from "@/lib/erp/item-linking";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/transactions/route";

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
  await updateRecord("Payments", "paymentId", paymentId, patch, "payment-final-save");

  const result = await callLegacy("post", { recordType: "payment", recordId: paymentId });
  const posted = (await findRecords<any>("Payments", { paymentId }, 1)).rows[0];
  return {
    recordId: paymentId,
    status: String(posted?.status || result?.status || "POSTED"),
    journalId: posted?.journalId || result?.journalId || "",
    advance: Boolean(result?.advance),
    finalized: true,
  };
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
      const supplierQuotation = body.action === "createSupplierQuote";
      const resolved = await resolveTransactionItems(rawLines, {
        allowTemporary: supplierQuotation,
        autoCreateMissing: !supplierQuotation,
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
