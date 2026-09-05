import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission, type Permission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/transactions/route";

const ACTION_PERMISSION: Record<string, Permission> = {
  createQuote: "sales.write",
  createInvoice: "sales.write",
  createSupplierQuote: "purchase.write",
  createPurchaseOrder: "purchase.write",
  createSupplierBill: "purchase.write",
  createExpense: "purchase.write",
  post: "post.approve",
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

function pngYear() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextNumber(action: string) {
  const config = SERIES[action];
  if (!config) return "";
  const year = pngYear();
  const prefix = `${config.prefix}-${year}-`;
  const rows = await listTable<any>(config.table, 500, 0);
  const max = rows.rows.reduce((current, row) => {
    const value = String(row[config.field] || "");
    if (!value.startsWith(prefix)) return current;
    const sequence = Number(value.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > current ? sequence : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    const response = await legacyGet();
    const body = await response.json();
    if (!body.ok) return NextResponse.json(body, { status: response.status });

    const allPurchaseOrders = Array.isArray(body.purchaseOrders) ? body.purchaseOrders : [];
    const supplierQuotes = allPurchaseOrders.filter((row: any) => String(row.poNumber || "").startsWith("SUPQ-"));
    const purchaseOrders = allPurchaseOrders.filter((row: any) => !String(row.poNumber || "").startsWith("SUPQ-"));

    return NextResponse.json({ ...body, supplierQuotes, purchaseOrders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : 401 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; payload?: Record<string, unknown> };
    let permission = body.action ? ACTION_PERMISSION[body.action] : undefined;
    if (body.action === "createPayment") {
      permission = String(body.payload?.partyType || "") === "Supplier" ? "purchase.write" : "sales.write";
    }
    if (!permission) return NextResponse.json({ ok: false, error: "Unsupported transaction action" }, { status: 400 });
    await requirePermission(permission);
    if (!env.APP_SECRET) throw new Error("Server compatibility credential is not configured");

    let payload = body.payload || {};
    const series = body.action ? SERIES[body.action] : undefined;
    if (body.action && series && !String(payload[series.payloadField] || "").trim()) {
      payload = { ...payload, [series.payloadField]: await nextNumber(body.action) };
    }

    const legacyAction = body.action === "createSupplierQuote" ? "createPurchaseOrder" : body.action;
    const internal = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: legacyAction, payload, secret: env.APP_SECRET }),
    });
    const response = await legacyPost(internal);
    const result = await response.json();
    if (body.action === "createSupplierQuote" && result?.ok && result?.result) {
      result.result.type = "supplierQuote";
    }
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
