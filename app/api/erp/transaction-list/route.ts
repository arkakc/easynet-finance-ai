import { NextRequest, NextResponse } from "next/server";
import { requirePermission, type Permission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";

type Scope =
  | "salesModule"
  | "purchaseModule"
  | "expenseModule"
  | "salesQuote"
  | "salesInvoice"
  | "salesPayment"
  | "supplierQuote"
  | "purchaseOrder"
  | "supplierInvoice"
  | "purchasePayment"
  | "expense";

const PERMISSION: Record<Scope, Permission> = {
  salesModule: "sales.read",
  purchaseModule: "purchase.read",
  expenseModule: "purchase.read",
  salesQuote: "sales.read",
  salesInvoice: "sales.read",
  salesPayment: "sales.read",
  supplierQuote: "purchase.read",
  purchaseOrder: "purchase.read",
  supplierInvoice: "purchase.read",
  purchasePayment: "purchase.read",
  expense: "purchase.read",
};

function newest(rows: any[]) {
  return [...rows].sort((a, b) => {
    const av = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const bv = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return (Number.isFinite(bv) ? bv : 0) - (Number.isFinite(av) ? av : 0);
  });
}

function emptyEnvelope(scope: Scope) {
  return {
    ok: true,
    scope,
    quotes: [] as any[],
    supplierQuotes: [] as any[],
    purchaseOrders: [] as any[],
    invoices: [] as any[],
    supplierBills: [] as any[],
    payments: [] as any[],
    expenses: [] as any[],
  };
}

export async function GET(request: NextRequest) {
  try {
    const scope = String(request.nextUrl.searchParams.get("scope") || "") as Scope;
    const permission = PERMISSION[scope];
    if (!permission) return NextResponse.json({ ok: false, error: "Invalid transaction scope" }, { status: 400 });
    await requirePermission(permission);

    if (scope === "salesModule") {
      const [quotes, invoices, payments] = await Promise.all([
        listTable<any>("Quotes", 500, 0),
        listTable<any>("Invoices", 500, 0),
        listTable<any>("Payments", 500, 0),
      ]);
      return NextResponse.json({
        ...emptyEnvelope(scope),
        quotes: newest(quotes.rows || []),
        invoices: newest(invoices.rows || []),
        payments: newest((payments.rows || []).filter((row: any) => String(row.partyType || "") === "Customer")),
      });
    }

    if (scope === "purchaseModule") {
      const [orders, bills, payments] = await Promise.all([
        listTable<any>("PurchaseOrders", 500, 0),
        listTable<any>("SupplierBills", 500, 0),
        listTable<any>("Payments", 500, 0),
      ]);
      const purchaseOrders = orders.rows || [];
      return NextResponse.json({
        ...emptyEnvelope(scope),
        supplierQuotes: newest(purchaseOrders.filter((row: any) => String(row.poNumber || "").toUpperCase().startsWith("SUPQ-"))),
        purchaseOrders: newest(purchaseOrders.filter((row: any) => !String(row.poNumber || "").toUpperCase().startsWith("SUPQ-"))),
        supplierBills: newest(bills.rows || []),
        payments: newest((payments.rows || []).filter((row: any) => String(row.partyType || "") === "Supplier")),
      });
    }

    if (scope === "expenseModule") {
      const expenses = await listTable<any>("Expenses", 500, 0);
      return NextResponse.json({ ...emptyEnvelope(scope), expenses: newest(expenses.rows || []) });
    }

    if (scope === "salesQuote") {
      const rows = await listTable<any>("Quotes", 500, 0);
      return NextResponse.json({ ok: true, scope, quotes: newest(rows.rows || []) });
    }
    if (scope === "salesInvoice") {
      const rows = await listTable<any>("Invoices", 500, 0);
      return NextResponse.json({ ok: true, scope, invoices: newest(rows.rows || []) });
    }
    if (scope === "salesPayment") {
      const rows = await listTable<any>("Payments", 500, 0);
      return NextResponse.json({ ok: true, scope, payments: newest((rows.rows || []).filter((row: any) => String(row.partyType || "") === "Customer")) });
    }
    if (scope === "supplierQuote" || scope === "purchaseOrder") {
      const rows = await listTable<any>("PurchaseOrders", 500, 0);
      const supplierQuote = scope === "supplierQuote";
      const filtered = (rows.rows || []).filter((row: any) => String(row.poNumber || "").toUpperCase().startsWith("SUPQ-") === supplierQuote);
      return NextResponse.json(supplierQuote
        ? { ok: true, scope, supplierQuotes: newest(filtered) }
        : { ok: true, scope, purchaseOrders: newest(filtered) });
    }
    if (scope === "supplierInvoice") {
      const includeSources = request.nextUrl.searchParams.get("includeSources") === "1";
      if (includeSources) {
        const [bills, orders] = await Promise.all([
          listTable<any>("SupplierBills", 500, 0),
          listTable<any>("PurchaseOrders", 500, 0),
        ]);
        return NextResponse.json({
          ok: true,
          scope,
          supplierBills: newest(bills.rows || []),
          purchaseOrders: newest((orders.rows || []).filter((row: any) => !String(row.poNumber || "").toUpperCase().startsWith("SUPQ-"))),
        });
      }
      const rows = await listTable<any>("SupplierBills", 500, 0);
      return NextResponse.json({ ok: true, scope, supplierBills: newest(rows.rows || []) });
    }
    if (scope === "purchasePayment") {
      const rows = await listTable<any>("Payments", 500, 0);
      return NextResponse.json({ ok: true, scope, payments: newest((rows.rows || []).filter((row: any) => String(row.partyType || "") === "Supplier")) });
    }

    const rows = await listTable<any>("Expenses", 500, 0);
    return NextResponse.json({ ok: true, scope, expenses: newest(rows.rows || []) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction list read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}
