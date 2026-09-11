import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth";
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

const VALID_SCOPES = new Set<Scope>([
  "salesModule", "purchaseModule", "expenseModule",
  "salesQuote", "salesInvoice", "salesPayment",
  "supplierQuote", "purchaseOrder", "supplierInvoice", "purchasePayment", "expense",
]);

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

function forbidden() {
  return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}

export const dynamic = "force-dynamic";

function inferScopeFromReferer(referer: string): Scope | "" {
  if (!referer) return "";
  try {
    const url = new URL(referer);
    if (url.pathname !== "/transactions") return "";
    const module = url.searchParams.get("module") || "sales";
    return module === "purchase" ? "purchaseModule" : module === "expense" ? "expenseModule" : "salesModule";
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  try {
    let rawScope = request.headers.get("x-erp-scope")
      || request.nextUrl.searchParams.get("scope")
      || "";
    if (!rawScope) {
      try {
        rawScope = new URL(request.url).searchParams.get("scope") || "";
      } catch {}
    }
    if (!rawScope) {
      rawScope = inferScopeFromReferer(request.headers.get("referer") || "");
    }
    const scope = (rawScope || "salesModule") as Scope;
    if (!VALID_SCOPES.has(scope)) return NextResponse.json({ ok: false, error: "Invalid transaction scope" }, { status: 400 });

    const user = await requirePermission("dashboard.read");
    const canSales = hasPermission(user, "sales.read");
    const canPurchase = hasPermission(user, "purchase.read");
    const canAccounts = hasPermission(user, "accounts.read");

    if (scope === "salesModule") {
      const [quotes, invoices, payments] = await Promise.all([
        canSales ? listTable<any>("Quotes", 500, 0) : Promise.resolve({ rows: [] as any[] }),
        canSales ? listTable<any>("Invoices", 500, 0) : Promise.resolve({ rows: [] as any[] }),
        (canSales || canAccounts) ? listTable<any>("Payments", 500, 0) : Promise.resolve({ rows: [] as any[] }),
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
        canPurchase ? listTable<any>("PurchaseOrders", 500, 0) : Promise.resolve({ rows: [] as any[] }),
        canPurchase ? listTable<any>("SupplierBills", 500, 0) : Promise.resolve({ rows: [] as any[] }),
        (canPurchase || canAccounts) ? listTable<any>("Payments", 500, 0) : Promise.resolve({ rows: [] as any[] }),
      ]);
      const purchaseOrders = orders.rows || [];
      const isSupq = (row: any) => String(row.poNumber || row.code || row.poId || "").toUpperCase().startsWith("SUPQ-");
      return NextResponse.json({
        ...emptyEnvelope(scope),
        supplierQuotes: newest(purchaseOrders.filter(isSupq)),
        purchaseOrders: newest(purchaseOrders.filter((row: any) => !isSupq(row))),
        supplierBills: newest(bills.rows || []),
        payments: newest((payments.rows || []).filter((row: any) => String(row.partyType || "") === "Supplier")),
      });
    }

    if (scope === "expenseModule") {
      if (!canPurchase) return NextResponse.json(emptyEnvelope(scope));
      const expenses = await listTable<any>("Expenses", 500, 0);
      return NextResponse.json({ ...emptyEnvelope(scope), expenses: newest(expenses.rows || []) });
    }

    if ((scope === "salesQuote" || scope === "salesInvoice") && !canSales) return forbidden();
    if ((scope === "supplierQuote" || scope === "purchaseOrder" || scope === "supplierInvoice" || scope === "expense") && !canPurchase) return forbidden();
    if (scope === "salesPayment" && !canSales && !canAccounts) return forbidden();
    if (scope === "purchasePayment" && !canPurchase && !canAccounts) return forbidden();

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
      const isSupq = (row: any) => String(row.poNumber || row.code || row.poId || "").toUpperCase().startsWith("SUPQ-");
      const filtered = (rows.rows || []).filter((row: any) => isSupq(row) === supplierQuote);
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
