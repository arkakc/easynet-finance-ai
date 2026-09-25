import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { inventoryState, round2, round4 } from "@/lib/accounting/inventory";

type ResolutionInput = {
  quoteLineId?: string;
  existingItemId?: string;
  itemName?: string;
  itemType?: "STOCK" | "SERVICE" | "NON_STOCK";
  uom?: string;
  revenueAccount?: string;
  costAccount?: string;
  deferredRevenueMonths?: number;
};

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isActive(value: unknown) {
  return !["false", "0", "no", "inactive"].includes(String(value ?? "true").trim().toLowerCase());
}

function normalizeItemType(value: unknown) {
  const type = String(value || "STOCK").trim().toUpperCase();
  return type === "SERVICE" || type === "NON_STOCK" ? type : "STOCK";
}

function itemIdentity(item: any) {
  return String(item?.itemId || item?.itemCode || "").trim();
}

function lineName(line: any) {
  return String(line?.description || line?.itemName || "").trim();
}

function nextSequence(items: any[]) {
  return items.reduce((max, item) => {
    const match = String(item.itemCode || item.itemId || "").toUpperCase().match(/^ITEM-(\d+)$/);
    return match ? Math.max(max, Number(match[1] || 0)) : max;
  }, 0);
}

async function loadSnapshot(quoteId: string) {
  const [quoteResult, lineResult, itemResult, movementResult, invoiceResult, allInvoiceLines, schedules, accounts] = await Promise.all([
    findRecords<any>("Quotes", { quoteId }, 1),
    findRecords<any>("QuoteLines", { quoteId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
    findRecords<any>("Invoices", { sourceDocumentId: quoteId }, 500),
    listTable<any>("InvoiceLines", 500, 0),
    findRecords<any>("PaymentSchedules", { sourceId: quoteId, sourceType: "SALES_QUOTE_REMAINDER_CLOSE" }, 20),
    listTable<any>("Accounts", 500, 0),
  ]);
  const quote = quoteResult.rows[0];
  if (!quote) throw new Error("Sales Quotation not found");
  return {
    quote,
    lines: [...(lineResult.rows || [])].sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0)),
    items: itemResult.rows || [],
    movements: movementResult.rows || [],
    invoices: (invoiceResult.rows || []).filter((row: any) =>
      !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase())
      && !String(row.invoiceNumber || "").toUpperCase().startsWith("CN-"),
    ),
    allInvoiceLines: allInvoiceLines.rows || [],
    closure: (schedules.rows || []).find((row: any) => String(row.status || "").toUpperCase() === "POSTED") || null,
    accounts: accounts.rows || [],
  };
}

function buildReadiness(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
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

  const activeInvoiceIds = new Set(snapshot.invoices.map((row: any) => String(row.invoiceId || "")));
  const invoicedByItem = new Map<string, number>();
  for (const line of snapshot.allInvoiceLines) {
    if (!activeInvoiceIds.has(String(line.invoiceId || ""))) continue;
    const itemId = String(line.itemId || "").trim();
    if (!itemId) continue;
    invoicedByItem.set(itemId, (invoicedByItem.get(itemId) || 0) + Number(line.qty || 0));
  }

  const temporaryLines: any[] = [];
  const requiredByItem = new Map<string, { item: any; quotedQty: number; lineNos: number[] }>();
  for (const line of snapshot.lines) {
    const persistedItemId = String(line.itemId || "").trim();
    const originalName = lineName(line);
    const exactMatches = itemsByName.get(normalized(originalName)) || [];
    const item = persistedItemId ? itemByIdentity.get(normalized(persistedItemId)) : undefined;
    if (!persistedItemId) {
      temporaryLines.push({
        quoteLineId: String(line.quoteLineId || ""),
        lineNo: Number(line.lineNo || 0),
        originalTempItemName: originalName,
        itemName: originalName,
        qty: Number(line.qty || 0),
        uom: String(line.uom || exactMatches[0]?.uom || "Each"),
        rate: Number(line.rate || 0),
        existingCandidates: exactMatches.filter((candidate: any) => isActive(candidate.active)).map((candidate: any) => ({
          itemId: itemIdentity(candidate),
          itemCode: String(candidate.itemCode || candidate.itemId || ""),
          itemName: String(candidate.itemName || ""),
          itemType: normalizeItemType(candidate.itemType),
          uom: String(candidate.uom || "Each"),
          movingAverageCost: Number(candidate.defaultRate || 0),
          revenueAccount: String(candidate.revenueAccount || ""),
          costAccount: String(candidate.costAccount || ""),
          deferredRevenueMonths: Number(candidate.deferredRevenueMonths || 0),
        })),
      });
      continue;
    }
    if (!item) continue;
    const itemId = itemIdentity(item);
    const current = requiredByItem.get(itemId) || { item, quotedQty: 0, lineNos: [] };
    current.quotedQty += Number(line.qty || 0);
    current.lineNos.push(Number(line.lineNo || 0));
    requiredByItem.set(itemId, current);
  }

  const stockLines = [...requiredByItem.entries()].map(([itemId, requirement]) => {
    const type = normalizeItemType(requirement.item.itemType);
    const invoicedQty = Number(invoicedByItem.get(itemId) || 0);
    const remainingQty = Math.max(0, requirement.quotedQty - invoicedQty);
    const state = inventoryState(
      snapshot.movements.filter((movement: any) => String(movement.itemId || "") === itemId),
      Number(requirement.item.defaultRate || 0),
    );
    const availableQty = type === "STOCK" ? Math.max(0, state.qty) : 0;
    const fulfillableQty = type === "STOCK" ? Math.min(remainingQty, availableQty) : remainingQty;
    const shortageQty = type === "STOCK" ? Math.max(0, remainingQty - availableQty) : 0;
    return {
      itemId,
      itemCode: String(requirement.item.itemCode || itemId),
      itemName: String(requirement.item.itemName || itemId),
      itemType: type,
      uom: String(requirement.item.uom || "Each"),
      quotedQty: round4(requirement.quotedQty),
      invoicedQty: round4(invoicedQty),
      remainingQty: round4(remainingQty),
      availableQty: round4(availableQty),
      fulfillableQty: round4(fulfillableQty),
      shortageQty: round4(shortageQty),
      movingAverageCost: round2(Number(state.rate || requirement.item.defaultRate || 0)),
      outOfStock: type === "STOCK" && remainingQty > 0.0001 && availableQty <= 0.0001,
      insufficientStock: type === "STOCK" && shortageQty > 0.0001,
      lineNos: requirement.lineNos,
    };
  });

  const remainingLines = stockLines.filter((line) => line.remainingQty > 0.0001);
  const needsProcurement = remainingLines.some((line) => line.insufficientStock);
  const fullyInvoiced = temporaryLines.length === 0 && remainingLines.length === 0;
  const canCreateInvoice = temporaryLines.length === 0 && remainingLines.some((line) => line.fulfillableQty > 0.0001);
  const canCreateFullInvoice = canCreateInvoice && !needsProcurement;
  const partialFulfilmentAvailable = canCreateInvoice && needsProcurement && remainingLines.some((line) => line.fulfillableQty > 0.0001);

  return {
    quote: {
      quoteId: String(snapshot.quote.quoteId || ""),
      quoteNumber: String(snapshot.quote.quoteNumber || snapshot.quote.quoteId || ""),
      customerId: String(snapshot.quote.customerId || ""),
      projectId: String(snapshot.quote.projectId || ""),
      status: String(snapshot.quote.status || "DRAFT"),
      totalAmount: Number(snapshot.quote.totalAmount || 0),
    },
    temporaryLines,
    stockLines,
    needsProcurement,
    fullyInvoiced,
    canCreateInvoice,
    canCreateFullInvoice,
    partialFulfilmentAvailable,
    existingInvoices: snapshot.invoices.map((row: any) => ({
      invoiceId: String(row.invoiceId || ""),
      invoiceNumber: String(row.invoiceNumber || row.invoiceId || ""),
      status: String(row.status || "DRAFT"),
      totalAmount: Number(row.totalAmount || 0),
      outstandingAmount: Number(row.outstandingAmount ?? row.totalAmount ?? 0),
    })),
    closure: snapshot.closure ? {
      allocationId: String(snapshot.closure.scheduleId || ""),
      remark: String(snapshot.closure.milestone || ""),
      date: String(snapshot.closure.dueDate || ""),
    } : null,
    allItemsPermanent: temporaryLines.length === 0,
  };
}

function validatePostingAccount(accounts: any[], accountId: string, kind: "revenue" | "cost") {
  const parentIds = new Set(accounts.map((row: any) => String(row.parentAccount || "")).filter(Boolean));
  const account = accounts.find((row: any) => String(row.accountId || "") === accountId);
  if (!account || !isActive(account.active) || parentIds.has(accountId)) throw new Error(`Invalid ${kind} posting account: ${accountId}`);
  const type = String(account.accountType || "").toLowerCase();
  if (kind === "revenue" && !["income", "revenue"].includes(type)) throw new Error(`Revenue account must be an Income posting account: ${accountId}`);
  if (kind === "cost" && !["expense", "cost of goods sold", "cogs"].includes(type)) throw new Error(`Cost account must be an Expense/COGS posting account: ${accountId}`);
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
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const body = await request.json() as { quoteId?: string; resolutions?: ResolutionInput[] };
    const quoteId = String(body.quoteId || "").trim();
    if (!quoteId) throw new Error("Sales Quotation is required");
    const state = await loadSnapshot(quoteId);
    const status = String(state.quote.status || "").toUpperCase();
    if (!["APPROVED", "PART_INVOICED"].includes(status)) {
      throw new Error("Sales Quotation must be APPROVED before temporary items can be made permanent");
    }

    const unresolved = state.lines.filter((line: any) => !String(line.itemId || "").trim());
    if (!unresolved.length) return NextResponse.json({ ok: true, createdItems: 0, linkedLines: 0, readiness: buildReadiness(state) });
    const resolutionMap = new Map((body.resolutions || []).map((row) => [String(row.quoteLineId || ""), row]));
    const itemById = new Map<string, any>();
    const itemByName = new Map<string, any[]>();
    for (const item of state.items) {
      const id = itemIdentity(item);
      if (id) itemById.set(id, item);
      const key = normalized(item.itemName);
      if (key) itemByName.set(key, [...(itemByName.get(key) || []), item]);
    }

    let sequence = nextSequence(state.items);
    const createItems: any[] = [];
    const linkPlan: Array<{ line: any; item: any }> = [];
    for (const line of unresolved) {
      const lineId = String(line.quoteLineId || "");
      const resolution = resolutionMap.get(lineId);
      if (!resolution) throw new Error(`Line ${line.lineNo}: complete Item Master details before continuing`);
      let item: any;
      const existingItemId = String(resolution.existingItemId || "").trim();
      if (existingItemId) {
        item = itemById.get(existingItemId);
        if (!item || !isActive(item.active)) throw new Error(`Line ${line.lineNo}: selected Item Master record is missing or inactive`);
      } else {
        const name = String(resolution.itemName || "").trim();
        if (name.length < 2) throw new Error(`Line ${line.lineNo}: Item Name is required`);
        const exact = (itemByName.get(normalized(name)) || []).filter((candidate: any) => isActive(candidate.active));
        if (exact.length) throw new Error(`Line ${line.lineNo}: Item Master already contains "${name}". Select the existing Item instead of creating a duplicate.`);
        const type = normalizeItemType(resolution.itemType);
        const revenueAccount = String(resolution.revenueAccount || (type === "SERVICE" ? "ACC-4100" : "ACC-4101"));
        const costAccount = String(resolution.costAccount || (type === "SERVICE" ? "ACC-5200" : "ACC-5111"));
        validatePostingAccount(state.accounts, revenueAccount, "revenue");
        validatePostingAccount(state.accounts, costAccount, "cost");
        sequence += 1;
        const code = `ITEM-${String(sequence).padStart(5, "0")}`;
        item = {
          itemId: code,
          itemCode: code,
          itemName: name,
          itemType: type,
          revenueAccount,
          costAccount,
          defaultRate: 0,
          taxCode: "",
          active: true,
          uom: String(resolution.uom || line.uom || "Each").trim() || "Each",
          deferredRevenueMonths: Math.max(0, Math.min(120, Math.trunc(Number(resolution.deferredRevenueMonths || 0)))),
        };
        createItems.push(item);
        itemById.set(code, item);
        itemByName.set(normalized(name), [item]);
      }
      linkPlan.push({ line, item });
    }

    if (createItems.length) await batchAppend("Items", createItems, "sales-quote:item-materialization");
    for (const { line, item } of linkPlan) {
      // Preserve QuoteLines.description as the original customer-facing TEMP wording.
      // itemId + Item Master carry the permanent normalized name/accounting identity.
      await updateRecord("QuoteLines", "quoteLineId", String(line.quoteLineId), {
        itemId: String(item.itemId || item.itemCode || ""),
        uom: String(item.uom || line.uom || "Each"),
      }, "sales-quote:item-materialization");
    }

    const refreshed = await loadSnapshot(quoteId);
    return NextResponse.json({
      ok: true,
      createdItems: createItems.length,
      linkedLines: linkPlan.length,
      readiness: buildReadiness(refreshed),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to finalize Sales Quotation items";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
