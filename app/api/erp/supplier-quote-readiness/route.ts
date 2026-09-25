import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";

type ResolutionInput = {
  poLineId?: string;
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

function canonicalItemName(value: unknown) {
  const raw = String(value || "").trim().toUpperCase();
  const withoutTempPrefix = raw.replace(/^\s*(TMP|TEMP|TEMPORARY)\s*[-_:]*\s*/i, "");
  return withoutTempPrefix.replace(/[^A-Z0-9]/g, "");
}

function isActive(value: unknown) {
  return !["false", "0", "no", "inactive"].includes(String(value ?? "true").trim().toLowerCase());
}

function itemType(value: unknown) {
  const type = String(value || "STOCK").trim().toUpperCase();
  return type === "SERVICE" || type === "NON_STOCK" ? type : "STOCK";
}

function nextSequence(items: any[]) {
  return items.reduce((max, item) => {
    const match = String(item.itemCode || item.itemId || "").toUpperCase().match(/^ITEM-(\d+)$/);
    return match ? Math.max(max, Number(match[1] || 0)) : max;
  }, 0);
}

async function snapshot(supplierQuoteId: string) {
  const [quoteResult, lineResult, itemResult, convertedResult, accountResult] = await Promise.all([
    findRecords<any>("PurchaseOrders", { poId: supplierQuoteId }, 1),
    findRecords<any>("POLines", { poId: supplierQuoteId }, 500),
    listTable<any>("Items", 500, 0),
    findRecords<any>("PurchaseOrders", { sourceDocumentId: supplierQuoteId }, 20),
    listTable<any>("Accounts", 500, 0),
  ]);
  const quote = quoteResult.rows[0];
  if (!quote || !String(quote.poNumber || "").toUpperCase().startsWith("SUPQ-")) {
    throw new Error("Supplier Quotation not found");
  }
  const existingPo = (convertedResult.rows || []).find((row: any) => !String(row.poNumber || "").toUpperCase().startsWith("SUPQ-")) || null;
  const items = itemResult.rows || [];
  const byName = new Map<string, any[]>();
  const byCanonicalName = new Map<string, any[]>();
  for (const item of items) {
    const key = normalized(item.itemName);
    if (key) byName.set(key, [...(byName.get(key) || []), item]);
    const canonicalKey = canonicalItemName(item.itemName);
    if (canonicalKey) byCanonicalName.set(canonicalKey, [...(byCanonicalName.get(canonicalKey) || []), item]);
  }
  const lines = [...(lineResult.rows || [])].sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0));
  const temporaryLines = lines
    .filter((line: any) => !String(line.itemId || "").trim())
    .map((line: any) => {
      const originalName = String(line.description || "").trim();
      return {
        poLineId: String(line.poLineId || ""),
        lineNo: Number(line.lineNo || 0),
        originalTempItemName: originalName,
        itemName: originalName,
        qty: Number(line.qty || 0),
        uom: String(line.uom || "Each"),
        rate: Number(line.rate || 0),
        existingCandidates: ((byName.get(normalized(originalName)) || []).length
          ? (byName.get(normalized(originalName)) || [])
          : (byCanonicalName.get(canonicalItemName(originalName)) || []))
          .filter((item: any) => isActive(item.active))
          .map((item: any) => ({
            itemId: String(item.itemId || item.itemCode || ""),
            itemCode: String(item.itemCode || item.itemId || ""),
            itemName: String(item.itemName || ""),
            itemType: itemType(item.itemType),
            uom: String(item.uom || "Each"),
            revenueAccount: String(item.revenueAccount || ""),
            costAccount: String(item.costAccount || ""),
            deferredRevenueMonths: Number(item.deferredRevenueMonths || 0),
          })),
      };
    });
  return {
    quote,
    lines,
    items,
    existingPo,
    accounts: accountResult.rows || [],
    readiness: {
      supplierQuoteId,
      supplierQuoteNumber: String(quote.poNumber || supplierQuoteId),
      status: String(quote.status || "DRAFT"),
      temporaryLines,
      allItemsPermanent: temporaryLines.length === 0,
      existingPo: existingPo ? {
        poId: String(existingPo.poId || ""),
        poNumber: String(existingPo.poNumber || existingPo.poId || ""),
        status: String(existingPo.status || "DRAFT"),
      } : null,
    },
  };
}

function validatePostingAccount(accounts:any[],accountId:string,kind:"revenue"|"cost"){
  const parentIds=new Set(accounts.map((row:any)=>String(row.parentAccount||"")).filter(Boolean));
  const account=accounts.find((row:any)=>String(row.accountId||"")===accountId);
  if(!account||!isActive(account.active)||parentIds.has(accountId))throw new Error(`Invalid ${kind} posting account: ${accountId}`);
  const type=String(account.accountType||"").toLowerCase();
  if(kind==="revenue"&&!["income","revenue"].includes(type))throw new Error(`Revenue account must be an Income posting account: ${accountId}`);
  if(kind==="cost"&&!["expense","cost of goods sold","cogs"].includes(type))throw new Error(`Cost account must be an Expense/COGS posting account: ${accountId}`);
}

export async function GET(request: Request) {
  try {
    await requirePermission("purchase.read");
    const supplierQuoteId = new URL(request.url).searchParams.get("supplierQuoteId")?.trim() || "";
    if (!supplierQuoteId) throw new Error("Supplier Quotation is required");
    const state = await snapshot(supplierQuoteId);
    return NextResponse.json({ ok: true, readiness: state.readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier Quotation readiness check failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("purchase.write");
    const body = await request.json() as { supplierQuoteId?: string; resolutions?: ResolutionInput[] };
    const supplierQuoteId = String(body.supplierQuoteId || "").trim();
    if (!supplierQuoteId) throw new Error("Supplier Quotation is required");
    const state = await snapshot(supplierQuoteId);
    if (state.existingPo) throw new Error(`Supplier Quotation already converted to ${state.existingPo.poNumber || state.existingPo.poId}`);
    if (String(state.quote.status || "").toUpperCase() !== "APPROVED") {
      throw new Error("Supplier Quotation must be APPROVED before temporary items can be made permanent");
    }

    const unresolved = state.lines.filter((line: any) => !String(line.itemId || "").trim());
    if (!unresolved.length) {
      return NextResponse.json({ ok: true, createdItems: 0, linkedLines: 0, readiness: state.readiness });
    }

    const resolutionMap = new Map((body.resolutions || []).map((row) => [String(row.poLineId || ""), row]));
    const itemById = new Map<string, any>();
    const itemByName = new Map<string, any[]>();
    const itemByCanonicalName = new Map<string, any[]>();
    for (const item of state.items) {
      const id = String(item.itemId || item.itemCode || "");
      if (id) itemById.set(id, item);
      const key = normalized(item.itemName);
      if (key) itemByName.set(key, [...(itemByName.get(key) || []), item]);
      const canonicalKey = canonicalItemName(item.itemName);
      if (canonicalKey) itemByCanonicalName.set(canonicalKey, [...(itemByCanonicalName.get(canonicalKey) || []), item]);
    }

    let sequence = nextSequence(state.items);
    const createItems: any[] = [];
    const linkPlan: Array<{ line: any; item: any }> = [];

    for (const line of unresolved) {
      const lineId = String(line.poLineId || "");
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
        const direct = (itemByName.get(normalized(name)) || []).filter((candidate: any) => isActive(candidate.active));
        const canonical = (itemByCanonicalName.get(canonicalItemName(name)) || []).filter((candidate: any) => isActive(candidate.active));
        const exact = direct.length ? direct : canonical;
        if (exact.length === 1) {
          item = exact[0];
          linkPlan.push({ line, item });
          continue;
        }
        if (exact.length > 1) {
          throw new Error(`Line ${line.lineNo}: multiple active Item Master records match "${name}". Select the correct existing Item before continuing.`);
        }
        sequence += 1;
        const code = `ITEM-${String(sequence).padStart(5, "0")}`;
        const type = itemType(resolution.itemType);
        const revenueAccount=String(resolution.revenueAccount || (type === "SERVICE" ? "ACC-4100" : "ACC-4101"));
        const costAccount=String(resolution.costAccount || (type === "SERVICE" ? "ACC-5200" : "ACC-5111"));
        validatePostingAccount(state.accounts,revenueAccount,"revenue");
        validatePostingAccount(state.accounts,costAccount,"cost");
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

    if (createItems.length) await batchAppend("Items", createItems, "supplier-quote:item-materialization");

    for (const { line, item } of linkPlan) {
      // Keep POLines.description unchanged: on a Supplier Quotation it is the original
      // temporary supplier wording. itemId is the permanent Item Master link. The UI
      // displays both, so the source document preserves the before/after audit trail.
      await updateRecord("POLines", "poLineId", String(line.poLineId), {
        itemId: String(item.itemId || item.itemCode || ""),
        uom: String(item.uom || line.uom || "Each"),
      }, "supplier-quote:item-materialization");
    }

    const refreshed = await snapshot(supplierQuoteId);
    const stillUnlinked = refreshed.lines.filter((line:any)=>!String(line.itemId||"").trim());
    if (stillUnlinked.length) {
      throw new Error(`${stillUnlinked.length} Supplier Quotation line(s) are still not linked to Item Master after save. Purchase Order conversion remains blocked.`);
    }
    return NextResponse.json({
      ok: true,
      createdItems: createItems.length,
      linkedLines: linkPlan.length,
      readiness: refreshed.readiness,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier Quotation item materialization failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
