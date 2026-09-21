import type { Prisma } from "@prisma/client";
import { inventoryState, round2, round4 } from "@/lib/accounting/inventory";

type WarehouseClient = Prisma.TransactionClient;

const incoming = new Set([
  "PURCHASE_IN",
  "PURCHASE_RECEIPT",
  "SALES_ISSUE_ROLLBACK",
  "ADJUSTMENT_IN",
  "RETURN_IN",
  "TRANSFER_IN",
]);
const outgoing = new Set([
  "SALES_DELIVERY",
  "SALES_ISSUE",
  "SALE_OUT",
  "PROJECT_ISSUE",
  "ADJUSTMENT_OUT",
  "RETURN_OUT",
  "TRANSFER_OUT",
]);
const adjustments = new Set(["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"]);

function stateRows(rows: Array<{ type: string; quantity: unknown; totalCost: unknown }>) {
  return rows.map((row) => {
    const type = String(row.type || "").toUpperCase();
    const quantity = Number(row.quantity || 0);
    const totalCost = Number(row.totalCost || 0);
    return {
      qtyIn: incoming.has(type) ? quantity : 0,
      qtyOut: outgoing.has(type) ? quantity : 0,
      value: adjustments.has(type) ? 0 : Math.abs(totalCost),
      valueAdjustment: adjustments.has(type) ? totalCost : 0,
    };
  });
}

export async function ensureDefaultWarehouse(tx: WarehouseClient) {
  const current = await tx.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (current) return current;

  const firstActive = await tx.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (firstActive) {
    return tx.warehouse.update({
      where: { id: firstActive.id },
      data: { isDefault: true },
    });
  }

  return tx.warehouse.create({
    data: {
      code: "MAIN",
      name: "Main Warehouse",
      location: "Primary stock location",
      isDefault: true,
      isActive: true,
    },
  });
}

export async function resolveWarehouse(
  tx: WarehouseClient,
  warehouseRef?: string | null,
) {
  const ref = String(warehouseRef || "").trim();
  if (!ref) return ensureDefaultWarehouse(tx);

  const warehouse = await tx.warehouse.findFirst({
    where: {
      OR: [
        { id: ref },
        { code: ref },
      ],
    },
  });
  if (!warehouse) throw new Error(`Warehouse not found: ${ref}`);
  if (!warehouse.isActive) throw new Error(`Warehouse is inactive: ${warehouse.code}`);
  return warehouse;
}

export async function warehouseInventoryState(
  tx: WarehouseClient,
  itemId: string,
  warehouseId: string,
  fallbackRate = 0,
  includeLegacyUnassigned = false,
) {
  const warehouse = await tx.warehouse.findUnique({
    where: { id: warehouseId },
    select: { isDefault: true },
  });
  const includeLegacy = includeLegacyUnassigned || warehouse?.isDefault === true;
  const rows = await tx.stockMovement.findMany({
    where: {
      itemId,
      ...(includeLegacy
        ? { OR: [{ warehouseId }, { warehouseId: null }] }
        : { warehouseId }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { type: true, quantity: true, totalCost: true },
  });
  return inventoryState(stateRows(rows), fallbackRate);
}

export async function syncWarehouseBalance(
  tx: WarehouseClient,
  input: {
    itemId: string;
    warehouseId: string;
    quantity: number;
    value: number;
    rate: number;
  },
) {
  const existing = await tx.warehouseStockBalance.findUnique({
    where: {
      itemId_warehouseId: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
      },
    },
  });
  const reserved = round4(Number(existing?.reserved || 0));
  const quantity = round4(input.quantity);
  const available = round4(Math.max(0, quantity - reserved));
  const stockValue = round2(input.value);
  const valuationRate = round4(input.rate);

  return tx.warehouseStockBalance.upsert({
    where: {
      itemId_warehouseId: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
      },
    },
    create: {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      quantity,
      reserved,
      available,
      stockValue,
      valuationRate,
    },
    update: {
      quantity,
      available,
      stockValue,
      valuationRate,
    },
  });
}

export async function recomputeWarehouseBalance(
  tx: WarehouseClient,
  input: {
    itemId: string;
    warehouseId: string;
    fallbackRate?: number;
    includeLegacyUnassigned?: boolean;
  },
) {
  const state = await warehouseInventoryState(
    tx,
    input.itemId,
    input.warehouseId,
    Number(input.fallbackRate || 0),
    input.includeLegacyUnassigned === true,
  );
  await syncWarehouseBalance(tx, {
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    quantity: state.qty,
    value: state.value,
    rate: state.rate,
  });
  return state;
}

export async function companyInventoryState(
  tx: WarehouseClient,
  itemId: string,
  fallbackRate = 0,
) {
  const rows = await tx.stockMovement.findMany({
    where: { itemId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { type: true, quantity: true, totalCost: true },
  });
  return inventoryState(stateRows(rows), fallbackRate);
}
