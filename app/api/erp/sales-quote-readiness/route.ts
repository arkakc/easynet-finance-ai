import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { inventoryState } from "@/lib/accounting/inventory";
import { resolveTransactionItems } from "@/lib/erp/item-linking";

type ItemChoice = {
  itemId?: string;
  itemType?: "STOCK" | "SERVICE" | "NON_STOCK";
  uom?: string;
};

type Snapshot = {
  quote: any;
  lines: any[];
  items: any[];
  movements: any[];
  existingInvoice: any | null;
};

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeItemType(value: unknown) {
  const type = String(value || "STOCK").trim().toUpperCase();
  if (type === "SERVICE" || type === "NON_STOCK") return type;
  return "STOCK";
}

function itemIdentity(item: any) {
  return String(item?.itemId || item?.itemCode || "").trim();
}

function lineName(line: any) {
  return String(line?.itemName || line?.description || "").trim();
}

async function loadSnapshot(quoteId: string): Promise<Snapshot> {
  const [quoteResult, lineResult, itemResult, movementResult, invoiceResult] = await Promise.all([
    findRecords<any>("Quotes", { quoteId }, 1),
    findRecords<any>("QuoteLines", { quoteId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
    findRecords<any>("Invoices", { sourceDocumentId: quoteId }, 10),
  ]);

  const quote = quoteResult.rows[0];
  if (!quote) throw new Error("Sales Quotation not found");

  return {
    quote,
    lines: [...(lineResult.rows || [])].sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0)),
    items: itemResult.rows || [],
    movements: movementResult.rows || [],
    existingInvoice: invoiceResult.rows[0] || null,
  };
}

function buildReadiness(snapshot: Snapshot) {
  const itemByIdentity = new Map<string, any>();
  const itemsByName = new Map<string, any[]>();

  for (const item of snapshot.items) {
    const id = itemIdentity(item);
    const code = String(item.itemCode || item.itemId || "").trim();
    if (id) itemByIdentity.set(normalized(id), item);
    if (code) itemByIdentity.set(normalized(code), item);
    const nameKey = normalized(item.itemName);
    if (nameKey) itemsByName.set(nameKey, [...(itemsByName.get(nameKey) || []), item]);
  }

  const temporaryLines: any[] = [];
  const requiredByItem = new Map<string, { item: any; requiredQty: number; lineNos: number[] }>();

  for (const line of snapshot.lines) {
    const persistedItemId = String(line.itemId || "").trim();
    const name = lineName(line);
    const exactMatches = itemsByName.get(normalized(name)) || [];
    let item = persistedItemId ? itemByIdentity.get(normalized(persistedItemId)) : undefined;

    if (!persistedItemId) {
      temporaryLines.push({
        quoteLineId: String(line.quoteLineId || ""),
        lineNo: Number(line.lineNo || 0),
        itemName: name,
        qty: Number(line.qty || 0),
        uom: String(line.uom || exactMatches[0]?.uom || "Each"),
        existingCandidates: exactMatches.map((candidate: any) => ({
          itemId: itemIdentity(candidate),
          itemCode: String(candidate.itemCode || candidate.itemId || ""),
          itemName: String(candidate.itemName || ""),
          itemType: normalizeItemType(candidate.itemType),
          uom: String(candidate.uom || "Each"),
          movingAverageCost: Number(candidate.defaultRate || 0),
        })),
      });
      if (exactMatches.length === 1) item = exactMatches[0];
    }

    if (!item) continue;
    const itemId = itemIdentity(item);
    if (!itemId) continue;
    const current = requiredByItem.get(itemId) || { item, requiredQty: 0, lineNos: [] };
    current.requiredQty += Number(line.qty || 0);
    current.lineNos.push(Number(line.lineNo || 0));
    requiredByItem.set(itemId, current);
  }

  const stockLines = [...requiredByItem.entries()].map(([itemId, requirement]) => {
    const type = normalizeItemType(requirement.item.itemType);
    const state = inventoryState(
      snapshot.movements.filter((movement: any) => String(movement.itemId || "") === itemId),
      Number(requirement.item.defaultRate || 0),
    );
    const availableQty = type === "STOCK" ? state.qty : 0;
    const shortageQty = type === "STOCK" ? Math.max(0, requirement.requiredQty - availableQty) : 0;
    return {
      itemId,
      itemCode: String(requirement.item.itemCode || itemId),
      itemName: String(requirement.item.itemName || itemId),
      itemType: type,
      uom: String(requirement.item.uom || "Each"),
      requiredQty: Number(requirement.requiredQty.toFixed(4)),
      availableQty,
      shortageQty: Number(shortageQty.toFixed(4)),
      movingAverageCost: Number(state.rate || requirement.item.defaultRate || 0),
      outOfStock: type === "STOCK" && availableQty <= 0.0001,
      insufficientStock: type === "STOCK" && shortageQty > 0.0001,
      lineNos: requirement.lineNos,
    };
  });

  const needsProcurement = stockLines.some((line) => line.insufficientStock);
  const existingInvoice = snapshot.existingInvoice
    ? {
        invoiceId: String(snapshot.existingInvoice.invoiceId || ""),
        invoiceNumber: String(snapshot.existingInvoice.invoiceNumber || snapshot.existingInvoice.invoiceId || ""),
        status: String(snapshot.existingInvoice.status || "DRAFT"),
      }
    : null;

  return {
    quote: {
      quoteId: String(snapshot.quote.quoteId || ""),
      quoteNumber: String(snapshot.quote.quoteNumber || snapshot.quote.quoteId || ""),
      customerId: String(snapshot.quote.customerId || ""),
      projectId: String(snapshot.quote.projectId || ""),
      status: String(snapshot.quote.status || "DRAFT"),
    },
    temporaryLines,
    stockLines,
    needsProcurement,
    readyToConvert: temporaryLines.length === 0 && !needsProcurement,
    existingInvoice,
  };
}

export async function GET(request: Request) {
  try {
    await requirePermission("sales.read");
    const quoteId = new URL(request.url).searchParams.get("quoteId")?.trim() || "";
    if (!quoteId) throw new Error("Sales Quotation is required");
    const snapshot = await loadSnapshot(quoteId);
    return NextResponse.json({ ok: true, readiness: buildReadiness(snapshot) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to check Sales Quotation readiness";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const body = await request.json() as {
      quoteId?: string;
      temporaryItems?: Record<string, ItemChoice>;
    };
    const quoteId = String(body.quoteId || "").trim();
    if (!quoteId) throw new Error("Sales Quotation is required");

    const snapshot = await loadSnapshot(quoteId);
    const status = String(snapshot.quote.status || "").toUpperCase();
    if (!["APPROVED", "CONVERTED"].includes(status)) {
      throw new Error("Sales Quotation must be APPROVED before temporary items can be finalized");
    }

    const choices = body.temporaryItems || {};
    const enrichedLines = snapshot.lines.map((line) => {
      const lineId = String(line.quoteLineId || "");
      if (String(line.itemId || "").trim()) return line;
      const choice = choices[lineId] || {};
      return {
        ...line,
        itemId: String(choice.itemId || "").trim(),
        itemCode: String(choice.itemId || "").trim(),
        itemType: normalizeItemType(choice.itemType),
        uom: String(choice.uom || line.uom || "Each").trim() || "Each",
      };
    });

    const resolved = await resolveTransactionItems(enrichedLines, {
      allowTemporary: false,
      autoCreateMissing: true,
      actor: "sales-quote:item-materialization",
      defaultNewItemType: "STOCK",
    });

    let updatedLines = 0;
    for (let index = 0; index < snapshot.lines.length; index += 1) {
      const original = snapshot.lines[index];
      if (String(original.itemId || "").trim()) continue;
      const resolvedLine: any = resolved.lines[index];
      const quoteLineId = String(original.quoteLineId || "").trim();
      if (!quoteLineId || !String(resolvedLine.itemId || "").trim()) continue;
      await updateRecord("QuoteLines", "quoteLineId", quoteLineId, {
        itemId: String(resolvedLine.itemId || ""),
        description: String(resolvedLine.itemName || resolvedLine.description || lineName(original)),
        uom: String(resolvedLine.uom || original.uom || "Each"),
      }, "sales-quote:item-materialization");
      updatedLines += 1;
    }

    const refreshed = await loadSnapshot(quoteId);
    return NextResponse.json({
      ok: true,
      createdItems: resolved.createdItems.length,
      linkedLines: updatedLines,
      readiness: buildReadiness(refreshed),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to finalize Sales Quotation items";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 },
    );
  }
}
