import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { inventoryState } from "@/lib/accounting/inventory";
import { POST as legacyPost } from "@/app/api/conversions/route";

function year() {
  return new Intl.DateTimeFormat("en", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
  }).format(new Date());
}

async function nextNumber(table: string, field: string, prefix: string) {
  const p = `${prefix}-${year()}-`;
  const rows = await listTable<any>(table, 500, 0);
  const max = rows.rows.reduce((m, row) => {
    const v = String(row[field] || "");
    if (!v.startsWith(p)) return m;
    const n = Number(v.slice(p.length));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${p}${String(max + 1).padStart(5, "0")}`;
}

function itemType(item: any) {
  return String(item?.itemType || "NON_STOCK").trim().toUpperCase();
}

async function assertSalesQuoteReady(quoteId: string, updateStock: boolean) {
  const [lineResult, itemResult, movementResult] = await Promise.all([
    findRecords<any>("QuoteLines", { quoteId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
  ]);

  const lines = lineResult.rows || [];
  if (!lines.length) throw new Error("Quotation has no lines");

  const temporary = lines.filter((line: any) => !String(line.itemId || "").trim());
  if (temporary.length) {
    throw new Error(
      `Quotation has ${temporary.length} temporary item line${temporary.length === 1 ? "" : "s"}. Create or link the item permanently in Item Master before creating the Sales Invoice.`,
    );
  }

  const itemMap = new Map<string, any>();
  for (const item of itemResult.rows || []) {
    const id = String(item.itemId || item.itemCode || "").trim();
    const code = String(item.itemCode || item.itemId || "").trim();
    if (id) itemMap.set(id, item);
    if (code) itemMap.set(code, item);
  }

  const requiredByItem = new Map<string, number>();
  for (const line of lines) {
    const itemId = String(line.itemId || "").trim();
    const item = itemMap.get(itemId);
    if (!item) throw new Error(`Item Master record not found for quotation line: ${itemId}`);
    if (itemType(item) !== "STOCK" || !updateStock) continue;
    requiredByItem.set(itemId, (requiredByItem.get(itemId) || 0) + Number(line.qty || 0));
  }

  const shortages: string[] = [];
  for (const [itemId, requiredQty] of requiredByItem.entries()) {
    const item = itemMap.get(itemId);
    const state = inventoryState(
      (movementResult.rows || []).filter((movement: any) => String(movement.itemId || "") === itemId),
      Number(item?.defaultRate || 0),
    );
    if (state.qty + 0.0001 >= requiredQty) continue;
    const shortage = Math.max(0, requiredQty - state.qty);
    const code = String(item?.itemCode || itemId);
    const name = String(item?.itemName || code);
    shortages.push(`${code} — ${name}: required ${requiredQty}, available ${state.qty}, shortage ${Number(shortage.toFixed(4))}`);
  }

  if (shortages.length) {
    throw new Error(
      `Insufficient stock for Sales Invoice conversion. ${shortages.join("; ")}. Create and approve a Purchase Order, then complete Purchase Receipt / Goods Receipt before converting this quotation.`,
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: "quoteToInvoice" | "poToBill";
      payload?: Record<string, unknown>;
    };
    if (!body.action) {
      return NextResponse.json({ ok: false, error: "Conversion action is required" }, { status: 400 });
    }

    await requirePermission(body.action === "quoteToInvoice" ? "sales.write" : "purchase.write");
    if (!env.APP_SECRET) throw new Error("Server compatibility credential is not configured");

    let payload = body.payload || {};
    if (body.action === "quoteToInvoice") {
      const quoteId = String(payload.quoteId || "").trim();
      if (!quoteId) throw new Error("Quotation is required");
      const updateStock = payload.updateStock !== false;
      await assertSalesQuoteReady(quoteId, updateStock);
      if (!String(payload.invoiceNumber || "").trim()) {
        payload = { ...payload, invoiceNumber: await nextNumber("Invoices", "invoiceNumber", "SI") };
      }
    }

    if (body.action === "poToBill" && !String(payload.billNumber || "").trim()) {
      payload = { ...payload, billNumber: await nextNumber("SupplierBills", "billNumber", "PB") };
    }

    return legacyPost(new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: body.action, payload, secret: env.APP_SECRET }),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 },
    );
  }
}
