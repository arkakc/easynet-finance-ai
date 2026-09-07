import { batchAppend, listTable } from "@/lib/backend/apps-script";

export type ItemMasterRow = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType?: string;
  revenueAccount?: string;
  costAccount?: string;
  defaultRate?: number | string;
  taxCode?: string;
  active?: boolean | string | number;
  uom?: string;
  deferredRevenueMonths?: number | string;
};

export type TransactionItemLine = {
  itemId?: string;
  itemCode?: string;
  itemName?: string;
  itemType?: string;
  description?: string;
  qty?: number | string;
  uom?: string;
  rate?: number | string;
  revenueAccountId?: string;
  costAccountId?: string;
  deferredRevenueMonths?: number | string;
  [key: string]: unknown;
};

type ResolveOptions = {
  allowTemporary: boolean;
  autoCreateMissing: boolean;
  actor: string;
  defaultNewItemType?: "STOCK" | "SERVICE" | "NON_STOCK";
};

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isActive(item: ItemMasterRow) {
  const value = String(item.active ?? "true").trim().toLowerCase();
  return !["false", "0", "no", "inactive"].includes(value);
}

function itemSequence(items: ItemMasterRow[]) {
  let max = 0;
  for (const item of items) {
    const code = String(item.itemCode || item.itemId || "").trim().toUpperCase();
    const match = code.match(/^ITEM-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1] || 0));
  }
  return max;
}

function lineName(line: TransactionItemLine) {
  return String(line.itemName || line.description || line.itemCode || line.itemId || "").trim();
}

function validNewItemType(value: unknown, fallback: ResolveOptions["defaultNewItemType"]) {
  const type = String(value || fallback || "STOCK").trim().toUpperCase();
  return type === "SERVICE" || type === "NON_STOCK" ? type : "STOCK";
}

function accountingMetadata(item: ItemMasterRow) {
  return {
    revenueAccountId: String(item.revenueAccount || (String(item.itemType || "").toUpperCase() === "SERVICE" ? "ACC-4100" : "ACC-4200")),
    costAccountId: String(item.costAccount || (String(item.itemType || "").toUpperCase() === "SERVICE" ? "ACC-5200" : "ACC-5100")),
    deferredRevenueMonths: Math.max(0, Math.trunc(Number(item.deferredRevenueMonths || 0))),
  };
}

/**
 * ERP-style item resolution for transaction rows.
 *
 * Item Master is the accounting/stock source of truth. Supplier Quotation is
 * the only document allowed to retain a temporary free-text row. Once a row is
 * linked, revenue/cost/UOM/deferred-revenue metadata is carried downstream so
 * conversions never silently fall back to a generic account.
 */
export async function resolveTransactionItems(
  rawLines: TransactionItemLine[],
  options: ResolveOptions,
) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw new Error("At least one item line is required");

  const itemResult = await listTable<ItemMasterRow>("Items", 500, 0);
  const existingItems = itemResult.rows || [];
  const byIdentity = new Map<string, ItemMasterRow>();
  const byName = new Map<string, ItemMasterRow[]>();

  for (const item of existingItems) {
    const idKey = normalized(item.itemId);
    const codeKey = normalized(item.itemCode);
    if (idKey) byIdentity.set(idKey, item);
    if (codeKey) byIdentity.set(codeKey, item);
    const nameKey = normalized(item.itemName);
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) || []), item]);
  }

  let sequence = itemSequence(existingItems);
  const createdItems: ItemMasterRow[] = [];
  const createdByKey = new Map<string, ItemMasterRow>();

  const resolvedLines = rawLines.map((line, index) => {
    const identity = normalized(line.itemId || line.itemCode);
    const name = lineName(line);
    const nameKey = normalized(name);

    let item: ItemMasterRow | undefined;
    if (identity) item = byIdentity.get(identity);

    if (!item && nameKey) {
      const sameName = byName.get(nameKey) || [];
      if (sameName.length === 1) item = sameName[0];
      if (sameName.length > 1 && !identity) {
        throw new Error(`Line ${index + 1}: multiple Item Master records use the name "${name}". Select the Item Code.`);
      }
    }

    if (item) {
      if (!isActive(item)) throw new Error(`Line ${index + 1}: Item is inactive: ${item.itemCode || item.itemId}`);
      return {
        ...line,
        itemId: String(item.itemId || item.itemCode),
        itemCode: String(item.itemCode || item.itemId),
        itemName: String(item.itemName || name),
        itemType: String(item.itemType || line.itemType || "STOCK"),
        description: String(item.itemName || name),
        uom: String(item.uom || line.uom || "Each"),
        movingAverageCost: Number(item.defaultRate || 0),
        taxCode: String(item.taxCode || ""),
        ...accountingMetadata(item),
      };
    }

    if (identity) {
      throw new Error(`Line ${index + 1}: Item Master record not found for ${String(line.itemId || line.itemCode)}`);
    }

    if (!name) throw new Error(`Line ${index + 1}: Item Name is required`);

    if (options.allowTemporary) {
      return {
        ...line,
        itemId: "",
        itemCode: "",
        itemName: name,
        description: name,
        uom: String(line.uom || "Each"),
        movingAverageCost: 0,
        revenueAccountId: "",
        costAccountId: "",
        deferredRevenueMonths: 0,
        temporaryItem: true,
      };
    }

    if (!options.autoCreateMissing) {
      throw new Error(`Line ${index + 1}: select an Item Master record before saving`);
    }

    const itemType = validNewItemType(line.itemType, options.defaultNewItemType);
    const uom = String(line.uom || "Each").trim() || "Each";
    const createKey = `${nameKey}|${normalized(uom)}|${itemType}`;
    let created = createdByKey.get(createKey);

    if (!created) {
      sequence += 1;
      const itemCode = `ITEM-${String(sequence).padStart(5, "0")}`;
      created = {
        itemId: itemCode,
        itemCode,
        itemName: name,
        itemType,
        revenueAccount: itemType === "SERVICE" ? "ACC-4100" : "ACC-4200",
        costAccount: itemType === "SERVICE" ? "ACC-5200" : "ACC-5100",
        defaultRate: 0,
        taxCode: "",
        active: true,
        uom,
        deferredRevenueMonths: 0,
      };
      createdItems.push(created);
      createdByKey.set(createKey, created);
      byIdentity.set(normalized(itemCode), created);
      byName.set(nameKey, [...(byName.get(nameKey) || []), created]);
    }

    return {
      ...line,
      itemId: created.itemId,
      itemCode: created.itemCode,
      itemName: created.itemName,
      itemType: created.itemType,
      description: created.itemName,
      uom,
      movingAverageCost: 0,
      ...accountingMetadata(created),
      autoCreatedItem: true,
    };
  });

  if (createdItems.length) {
    await batchAppend("Items", createdItems, options.actor);
  }

  return {
    lines: resolvedLines,
    createdItems,
    linkedCount: resolvedLines.filter((line) => String(line.itemId || "").trim()).length,
    temporaryCount: resolvedLines.filter((line) => !String(line.itemId || "").trim()).length,
  };
}
