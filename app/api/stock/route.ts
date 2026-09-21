import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/src/lib/prisma";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { requirePermission } from "@/lib/auth";
import { inventoryState, round2, round4, weightedRate } from "@/lib/accounting/inventory";
import {
  inventoryAdjustmentPosting,
  inventoryIssuePosting,
  postJournal,
  purchaseReceiptPosting,
  type PostingLine,
} from "@/lib/accounting/posting";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { postPurchaseReceiptAtomic, postStockMovementAtomic, postStockValueAdjustmentAtomic, transferStockAtomic } from "@/lib/accounting/atomic-stock";
import { ensureDefaultWarehouse } from "@/lib/accounting/warehouse-stock";

const itemSchema = z.object({
  itemId: z.string().trim().optional().default(""),
  itemCode: z.string().trim().optional().default(""),
  itemName: z.string().trim().min(2),
  itemType: z.enum(["STOCK", "SERVICE", "NON_STOCK"]).default("STOCK"),
  revenueAccount: z.string().trim().min(1),
  costAccount: z.string().trim().min(1),
  defaultRate: z.coerce.number().finite().nonnegative().optional().default(0),
  taxCode: z.string().trim().min(1),
  uom: z.string().trim().min(1).default("Each"),
  deferredRevenueMonths: z.coerce.number().int().min(0).max(120).optional().default(0),
});

const movementSchema = z.object({
  movementDate: z.string().trim().min(8),
  itemId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  warehouseId: z.string().trim().optional().default(""),
  movementType: z.enum(["PROJECT_ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "RETURN_IN", "RETURN_OUT"]),
  qty: z.coerce.number().finite().positive(),
  unitCost: z.coerce.number().finite().nonnegative().optional().default(0),
  sourceDocumentId: z.string().trim().optional().default(""),
});

const purchaseReceiptSchema = z.object({
  movementDate: z.string().trim().min(8),
  sourceDocumentId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  warehouseId: z.string().trim().optional().default(""),
  lines: z.array(z.object({
    itemId: z.string().trim().min(1),
    qty: z.coerce.number().finite().positive(),
  })).min(1),
});

const valueAdjustmentSchema = z.object({
  movementDate: z.string().trim().min(8),
  itemId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  warehouseId: z.string().trim().optional().default(""),
  adjustmentType: z.enum(["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"]),
  amount: z.coerce.number().finite().nonnegative().optional().default(0),
  targetUnitCost: z.coerce.number().finite().nonnegative().optional().default(0),
  sourceDocumentId: z.string().trim().optional().default(""),
});

const warehouseSchema = z.object({
  code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/, "Warehouse code may use letters, numbers, underscore and hyphen only"),
  name: z.string().trim().min(2).max(120),
  location: z.string().trim().max(240).optional().default(""),
  isDefault: z.coerce.boolean().optional().default(false),
});

const transferSchema = z.object({
  movementDate: z.string().trim().min(8),
  itemId: z.string().trim().min(1),
  fromWarehouseId: z.string().trim().min(1),
  toWarehouseId: z.string().trim().min(1),
  qty: z.coerce.number().finite().positive(),
  projectId: z.string().trim().optional().default(""),
  sourceDocumentId: z.string().trim().optional().default(""),
  note: z.string().trim().max(500).optional().default(""),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

function nextItemCode(items: any[]) {
  let max = 0;
  for (const row of items) {
    const value = String(row.itemCode || row.itemId || "").trim().toUpperCase();
    const match = value.match(/^ITEM-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1] || 0));
  }
  return `ITEM-${String(max + 1).padStart(5, "0")}`;
}

function approvedPurchaseOrderStatus(value: unknown) {
  return ["APPROVED", "SENT", "PART_RECEIVED", "PARTIAL_RECEIVED", "RECEIVED", "PART_BILLED", "CONVERTED", "BILL_CREATED", "BILLED"].includes(String(value || "").toUpperCase());
}

function publicPurchaseOrderStatus(value: unknown) {
  const status = String(value || "DRAFT").toUpperCase();
  if (status === "SENT") return "APPROVED";
  if (status === "PARTIAL_RECEIVED") return "PART_RECEIVED";
  if (status === "CANCELLED" || status === "CANCEL") return "CANCELLED";
  return status || "DRAFT";
}

function stockItemType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  return type === "GOOD" ? "STOCK" : type === "NON_INVENTORY" ? "NON_STOCK" : type;
}

function isStockItem(item: any) {
  return stockItemType(item?.itemType || item?.type) === "STOCK";
}

function mergeReceiptLines(lines: Array<{ itemId: string; qty: number }>) {
  const merged = new Map<string, number>();
  for (const line of lines) merged.set(line.itemId, (merged.get(line.itemId) || 0) + Number(line.qty || 0));
  return [...merged.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

function receiptQty(rows: any[], poId: string, itemId: string) {
  return rows
    .filter((movement: any) => String(movement.sourceDocumentId || "") === poId
      && String(movement.itemId || "") === itemId
      && String(movement.movementType || "") === "PURCHASE_RECEIPT")
    .reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
}

export async function GET(request: Request) {
  try {
    await requirePermission("stock.read");
    const scope = new URL(request.url).searchParams.get("scope") || "full";
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      await prisma.$transaction(async (tx) => { await ensureDefaultWarehouse(tx); });
      const [items, movements, purchaseOrders, poLines, warehouses, warehouseBalances] = await Promise.all([
        prisma.item.findMany({ orderBy: { code: "asc" } }),
        prisma.stockMovement.findMany({ include: { warehouse: true }, orderBy: { createdAt: "desc" } }),
        prisma.purchaseOrder.findMany({ include: { lines: true }, orderBy: { code: "asc" } }),
        prisma.pOLine.findMany(),
        prisma.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { code: "asc" }] }),
        prisma.warehouseStockBalance.findMany({ include: { warehouse: true, item: { select: { code: true, name: true } } }, orderBy: [{ warehouse: { code: "asc" } }, { item: { code: "asc" } }] }),
      ]);
      const localItems = items.map((item) => {
        const rows = movements.filter((movement) => movement.itemId === item.id);
        const state = inventoryState(rows.map((row) => {
          const type = String(row.type || "").toUpperCase();
          const quantity = Number(row.quantity || 0);
          const totalCost = Number(row.totalCost || 0);
          const adjustment = ["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"].includes(type);
          const incoming = ["PURCHASE_IN", "PURCHASE_RECEIPT", "SALES_ISSUE_ROLLBACK", "ADJUSTMENT_IN", "RETURN_IN", "TRANSFER_IN"].includes(type);
          const outgoing = ["SALES_DELIVERY", "SALES_ISSUE", "SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_OUT", "RETURN_OUT", "TRANSFER_OUT"].includes(type);
          return {
            qtyIn: incoming ? quantity : 0,
            qtyOut: outgoing ? quantity : 0,
            value: adjustment ? 0 : Math.abs(totalCost),
            valueAdjustment: adjustment ? totalCost : 0,
          };
        }), Number(item.purchasePrice || 0));
        const stockValue = state.value;
        return {
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          itemType: item.type === "GOOD" ? "STOCK" : item.type,
          uom: item.unit,
          revenueAccount: item.revenueAccount || "",
          costAccount: item.costAccount || "",
          defaultRate: state.rate,
          taxCode: item.taxCode || "",
          stockQty: state.qty,
          stockValue,
          deferredRevenueMonths: 0,
        };
      });
      if (scope === "items") return NextResponse.json({
        ok: true, source: "prisma", items: localItems,
        warehouses: warehouses.map((warehouse) => ({ warehouseId: warehouse.id, warehouseCode: warehouse.code, warehouseName: warehouse.name, location: warehouse.location || "", isDefault: warehouse.isDefault, active: warehouse.isActive })),
        nextItemCode: nextItemCode(localItems),
      });
      return NextResponse.json({
        ok: true,
        source: "prisma",
        items: localItems,
        warehouses: warehouses.map((warehouse) => ({
          warehouseId: warehouse.id, warehouseCode: warehouse.code, warehouseName: warehouse.name,
          location: warehouse.location || "", isDefault: warehouse.isDefault, active: warehouse.isActive,
        })),
        warehouseBalances: warehouseBalances.map((balance) => ({
          balanceId: balance.id, itemId: balance.itemId, itemCode: balance.item.code, itemName: balance.item.name,
          warehouseId: balance.warehouseId, warehouseCode: balance.warehouse.code, warehouseName: balance.warehouse.name,
          quantity: Number(balance.quantity || 0), reserved: Number(balance.reserved || 0),
          available: Number(balance.available || 0), valuationRate: Number(balance.valuationRate || 0), stockValue: Number(balance.stockValue || 0),
        })),
        movements: movements.map((movement) => ({
          movementId: movement.id,
          movementDate: movement.createdAt.toISOString(),
          itemId: movement.itemId,
          projectId: movement.projectId || "",
          warehouseId: movement.warehouseId || "",
          warehouseCode: movement.warehouse?.code || "",
          warehouseName: movement.warehouse?.name || "",
          transferId: movement.transferId || "",
          movementType: movement.type,
          referenceType: movement.referenceType || "",
          qtyIn: ["PURCHASE_IN", "PURCHASE_RECEIPT", "ADJUSTMENT_IN", "RETURN_IN", "TRANSFER_IN"].includes(movement.type) ? Number(movement.quantity) : 0,
          qtyOut: ["SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_OUT", "RETURN_OUT", "TRANSFER_OUT"].includes(movement.type) ? Number(movement.quantity) : 0,
          unitCost: Number(movement.unitCost || 0),
          value: Number(movement.totalCost || 0),
          sourceDocumentId: movement.referenceId || "",
          journalId: movement.journalId || "",
        })),
        purchaseOrders: purchaseOrders.map((order) => ({
          poId: order.id,
          poNumber: order.code,
          supplierId: order.supplierId,
          projectId: order.projectId || "",
          status: publicPurchaseOrderStatus(order.status),
          totalAmount: Number(order.total),
        })),
        poLines: poLines.map((line) => ({
          poLineId: line.id,
          poId: line.orderId,
          itemId: line.itemId || "",
          description: line.description,
          qty: Number(line.quantity),
          uom: line.unit,
          rate: Number(line.unitPrice),
        })),
        nextItemCode: nextItemCode(localItems),
      });
    }
    if (scope === "items") {
      const items = await listTable<any>("Items", 500, 0);
      return NextResponse.json({
        ok: true,
        items: items.rows.map((item: any) => ({
          ...item,
          uom: String(item.uom || "Each"),
          deferredRevenueMonths: Number(item.deferredRevenueMonths || 0),
        })),
        nextItemCode: nextItemCode(items.rows),
      });
    }

    const [items, movements, purchaseOrders, poLines] = await Promise.all([
      listTable<any>("Items", 500, 0),
      listTable<any>("StockMovements", 500, 0),
      listTable<any>("PurchaseOrders", 500, 0),
      listTable<any>("POLines", 500, 0),
    ]);

    const enrichedItems = items.rows.map((item: any) => {
      const rows = movements.rows.filter((movement: any) => String(movement.itemId || "") === String(item.itemId || ""));
      const state = inventoryState(rows, Number(item.defaultRate || 0));
      return {
        ...item,
        uom: String(item.uom || "Each"),
        deferredRevenueMonths: Number(item.deferredRevenueMonths || 0),
        defaultRate: state.rate,
        stockQty: state.qty,
        stockValue: state.value,
      };
    });

    return NextResponse.json({
      ok: true,
      items: enrichedItems,
      movements: movements.rows,
      purchaseOrders: purchaseOrders.rows,
      poLines: poLines.rows,
      nextItemCode: nextItemCode(items.rows),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock read failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

async function createPurchaseReceipt(raw: unknown) {
  const record = purchaseReceiptSchema.parse(raw || {});
  const lines = mergeReceiptLines(record.lines);
  await ensureAccountingInfrastructure();
  const defaults = await loadConfiguredPostingAccounts();
  const receiptNumber = documentSeriesId("PR");
  const movementDate = normalizeAccountingDate(record.movementDate);

  return postPurchaseReceiptAtomic({
    receiptNumber,
    postingDate: movementDate,
    purchaseOrderRef: record.sourceDocumentId,
    projectRef: record.projectId || undefined,
    warehouseRef: record.warehouseId || undefined,
    lines: lines.map((line) => ({ itemRef: line.itemId, qty: line.qty })),
    inventoryAccountId: defaults.defaultInventoryAccount,
    grniAccountId: defaults.stockReceivedButNotBilledAccount,
    createdBy: "purchase-receipt-ui",
    approvedBy: "Finance Controller",
  });
}

async function createPhysicalMovement(raw: unknown) {
  const record = movementSchema.parse(raw || {});
  await ensureAccountingInfrastructure();
  const defaults = await loadConfiguredPostingAccounts();
  const movementId = documentSeriesId("Movement");
  const movementDate = normalizeAccountingDate(record.movementDate);

  const posted = await postStockMovementAtomic({
    movementId,
    postingDate: movementDate,
    itemRef: record.itemId,
    projectRef: record.projectId || undefined,
    warehouseRef: record.warehouseId || undefined,
    movementType: record.movementType,
    qty: record.qty,
    unitCost: record.unitCost,
    sourceDocumentId: record.sourceDocumentId || undefined,
    inventoryAccountId: defaults.defaultInventoryAccount,
    defaultCostAccountId: defaults.defaultCostOfGoodsSoldAccount,
    stockAdjustmentAccountId: defaults.stockAdjustmentAccount,
    expensesIncludedInValuationAccountId: defaults.expensesIncludedInValuationAccount,
    createdBy: "stock-ui",
    approvedBy: "Finance Controller",
  });

  return {
    row: {
      movementId: posted.movementId,
      itemId: record.itemId,
      movementType: record.movementType,
      warehouseId: posted.warehouse.id,
      warehouseCode: posted.warehouse.code,
      journalId: posted.journalId,
    },
    journalId: posted.journalId,
    valuation: posted.valuation,
  };
}

async function createValueAdjustment(raw: unknown) {
  const record = valueAdjustmentSchema.parse(raw || {});
  await ensureAccountingInfrastructure();
  const defaults = await loadConfiguredPostingAccounts();
  const movementId = documentSeriesId("Value Adjustment");
  const movementDate = normalizeAccountingDate(record.movementDate);

  const posted = await postStockValueAdjustmentAtomic({
    movementId,
    postingDate: movementDate,
    itemRef: record.itemId,
    projectRef: record.projectId || undefined,
    warehouseRef: record.warehouseId || undefined,
    adjustmentType: record.adjustmentType,
    amount: record.amount,
    targetUnitCost: record.targetUnitCost,
    sourceDocumentId: record.sourceDocumentId || undefined,
    inventoryAccountId: defaults.defaultInventoryAccount,
    defaultCostAccountId: defaults.defaultCostOfGoodsSoldAccount,
    stockAdjustmentAccountId: defaults.stockAdjustmentAccount,
    expensesIncludedInValuationAccountId: defaults.expensesIncludedInValuationAccount,
    createdBy: "stock-value-adjustment",
    approvedBy: "Finance Controller",
  });

  return {
    row: {
      movementId: posted.movementId,
      itemId: record.itemId,
      movementType: record.adjustmentType,
      warehouseId: posted.warehouse.id,
      warehouseCode: posted.warehouse.code,
      journalId: posted.journalId,
    },
    journalId: posted.journalId,
    valuation: posted.valuation,
  };
}

async function createWarehouse(raw: unknown) {
  const record = warehouseSchema.parse(raw || {});
  const code = record.code.toUpperCase();
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.warehouse.findUnique({ where: { code } });
    if (duplicate) throw new Error(`Warehouse code already exists: ${code}`);
    const count = await tx.warehouse.count();
    const makeDefault = record.isDefault || count === 0;
    if (record.isDefault && count > 0) {
      const legacyUnassigned = await tx.stockMovement.count({ where: { warehouseId: null } });
      if (legacyUnassigned > 0) {
        throw new Error(
          "Legacy stock movements are still unassigned. Run the controlled warehouse backfill before changing the default warehouse.",
        );
      }
    }
    if (makeDefault) await tx.warehouse.updateMany({ data: { isDefault: false } });
    const warehouse = await tx.warehouse.create({
      data: { code, name: record.name, location: record.location || null, isDefault: makeDefault, isActive: true },
    });
    return { warehouseId: warehouse.id, warehouseCode: warehouse.code, warehouseName: warehouse.name, location: warehouse.location || "", isDefault: warehouse.isDefault };
  });
}

async function createWarehouseTransfer(raw: unknown) {
  const record = transferSchema.parse(raw || {});
  const transferId = documentSeriesId("TRF");
  return transferStockAtomic({
    transferId,
    postingDate: normalizeAccountingDate(record.movementDate),
    itemRef: record.itemId,
    fromWarehouseRef: record.fromWarehouseId,
    toWarehouseRef: record.toWarehouseId,
    qty: record.qty,
    projectRef: record.projectId || undefined,
    sourceDocumentId: record.sourceDocumentId || undefined,
    note: record.note || undefined,
    createdBy: "warehouse-transfer-ui",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; action?: "createItem" | "createMovement" | "createPurchaseReceipt" | "createValueAdjustment" | "createWarehouse" | "createTransfer"; record?: unknown };
    requireSecret(body.secret);

    if (body.action === "createItem") {
      const record = itemSchema.parse(body.record || {});
      const items = await listTable<any>("Items", 500, 0);
      const itemCode = nextItemCode(items.rows);
      const byCode = await findRecords("Items", { itemCode }, 1);
      if (byCode.rows.length) throw new Error(`Generated item code already exists: ${itemCode}. Refresh and try again.`);
      const result = await appendRecord("Items", {
        itemId: itemCode,
        itemCode,
        itemName: record.itemName,
        itemType: record.itemType,
        revenueAccount: record.revenueAccount,
        costAccount: record.costAccount,
        defaultRate: 0,
        taxCode: record.taxCode,
        active: true,
        uom: record.uom,
        deferredRevenueMonths: record.itemType === "STOCK" ? 0 : record.deferredRevenueMonths,
      }, "stock-ui");
      return NextResponse.json({ ok: true, row: result.row });
    }

    if (body.action === "createWarehouse") return NextResponse.json({ ok: true, warehouse: await createWarehouse(body.record) });
    if (body.action === "createTransfer") return NextResponse.json({ ok: true, transfer: await createWarehouseTransfer(body.record) });
    if (body.action === "createPurchaseReceipt") return NextResponse.json({ ok: true, ...(await createPurchaseReceipt(body.record)) });
    if (body.action === "createMovement") return NextResponse.json({ ok: true, ...(await createPhysicalMovement(body.record)) });
    if (body.action === "createValueAdjustment") return NextResponse.json({ ok: true, ...(await createValueAdjustment(body.record)) });
    throw new Error("Unsupported stock action");
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Stock write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
