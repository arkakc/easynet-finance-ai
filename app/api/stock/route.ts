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
  movementType: z.enum(["PROJECT_ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "RETURN_IN", "RETURN_OUT"]),
  qty: z.coerce.number().finite().positive(),
  unitCost: z.coerce.number().finite().nonnegative().optional().default(0),
  sourceDocumentId: z.string().trim().optional().default(""),
});

const purchaseReceiptSchema = z.object({
  movementDate: z.string().trim().min(8),
  sourceDocumentId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  lines: z.array(z.object({
    itemId: z.string().trim().min(1),
    qty: z.coerce.number().finite().positive(),
  })).min(1),
});

const valueAdjustmentSchema = z.object({
  movementDate: z.string().trim().min(8),
  itemId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  adjustmentType: z.enum(["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"]),
  amount: z.coerce.number().finite().nonnegative().optional().default(0),
  targetUnitCost: z.coerce.number().finite().nonnegative().optional().default(0),
  sourceDocumentId: z.string().trim().optional().default(""),
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

function inverseLines(lines: PostingLine[]) {
  return lines.map((line) => ({
    ...line,
    debit: Number(line.credit || 0),
    credit: Number(line.debit || 0),
    description: `Rollback: ${line.description || "inventory posting"}`,
  }));
}

async function compensateJournal(input: {
  postingDate: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  projectId?: string;
  lines: PostingLine[];
  reason: string;
}) {
  try {
    await postJournal({
      postingDate: input.postingDate,
      documentType: `${input.documentType}_ROLLBACK`,
      documentId: input.documentId,
      documentNumber: `${input.documentNumber}-ROLLBACK`,
      reference: input.reason,
      projectId: input.projectId,
      lines: inverseLines(input.lines),
      createdBy: "stock-rollback",
      approvedBy: "System Compensation",
    });
  } catch (rollbackError) {
    try {
      await appendRecord("Exceptions", {
        severity: "CRITICAL",
        module: "Stock Accounting",
        recordType: input.documentType,
        recordId: input.documentId,
        message: `Automatic GL compensation failed: ${rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error"}`,
        status: "OPEN",
        assignedTo: "Finance Controller",
      }, "stock-accounting-rollback");
    } catch { /* best effort */ }
  }
}

export async function GET(request: Request) {
  try {
    await requirePermission("stock.read");
    const scope = new URL(request.url).searchParams.get("scope") || "full";
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      const [items, movements, purchaseOrders, poLines] = await Promise.all([
        prisma.item.findMany({ orderBy: { code: "asc" } }),
        prisma.stockMovement.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.purchaseOrder.findMany({ include: { lines: true }, orderBy: { code: "asc" } }),
        prisma.pOLine.findMany(),
      ]);
      const localItems = items.map((item) => {
        const rows = movements.filter((movement) => movement.itemId === item.id);
        const qtyIn = rows.filter((row) => ["PURCHASE_IN", "PURCHASE_RECEIPT", "ADJUSTMENT_IN", "RETURN_IN", "TRANSFER_IN"].includes(String(row.type))).reduce((sum, row) => sum + Number(row.quantity), 0);
        const qtyOut = rows.filter((row) => ["SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_OUT", "RETURN_OUT", "TRANSFER_OUT"].includes(String(row.type))).reduce((sum, row) => sum + Number(row.quantity), 0);
        const stockValue = rows.reduce((sum, row) => sum + (Number(row.totalCost || 0) || Number(row.quantity) * Number(row.unitCost || 0)), 0);
        return {
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          itemType: item.type === "GOOD" ? "STOCK" : item.type,
          uom: item.unit,
          revenueAccount: item.revenueAccount || "",
          costAccount: item.costAccount || "",
          defaultRate: item.sellPrice || 0,
          taxCode: item.taxCode || "",
          stockQty: qtyIn - qtyOut,
          stockValue,
          deferredRevenueMonths: 0,
        };
      });
      if (scope === "items") return NextResponse.json({ ok: true, source: "prisma", items: localItems, nextItemCode: nextItemCode(localItems) });
      return NextResponse.json({
        ok: true,
        source: "prisma",
        items: localItems,
        movements: movements.map((movement) => ({
          movementId: movement.id,
          movementDate: movement.createdAt.toISOString(),
          itemId: movement.itemId,
          projectId: movement.projectId || "",
          movementType: movement.referenceType || movement.type,
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

  const [poResult, poLinesResult, itemsResult, movementsResult, defaults] = await Promise.all([
    findRecords<any>("PurchaseOrders", { poId: record.sourceDocumentId }, 1),
    findRecords<any>("POLines", { poId: record.sourceDocumentId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
    loadConfiguredPostingAccounts(),
  ]);

  const po = poResult.rows[0];
  if (!po || String(po.poNumber || "").toUpperCase().startsWith("SUPQ-")) throw new Error("Purchase Receipt source must be a valid Purchase Order");
  if (!approvedPurchaseOrderStatus(po.status)) throw new Error("Purchase Receipt can only be created from an approved Purchase Order");
  if (record.projectId && String(po.projectId || "") !== record.projectId) throw new Error("Purchase Receipt project does not match the Purchase Order");

  const itemMap = new Map(itemsResult.rows.map((item: any) => [String(item.itemId || ""), item]));
  const receiptNumber = documentSeriesId("PR");
  const movementDate = normalizeAccountingDate(record.movementDate);
  const movementsToCreate: any[] = [];
  const valuations: any[] = [];
  let inventoryValue = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const item = itemMap.get(line.itemId);
    if (!item) throw new Error(`Item does not exist: ${line.itemId}`);
    if (!isStockItem(item)) throw new Error(`Purchase Receipt can only receive STOCK items: ${item.itemCode || line.itemId}`);

    const matchingPoLines = poLinesResult.rows.filter((poLine: any) => String(poLine.itemId || "") === line.itemId);
    if (!matchingPoLines.length) throw new Error(`Purchase Order item is not linked to Item Master: ${item.itemCode || line.itemId}`);
    const orderedQty = matchingPoLines.reduce((sum: number, poLine: any) => sum + Number(poLine.qty || 0), 0);
    const alreadyReceived = receiptQty(movementsResult.rows, record.sourceDocumentId, line.itemId);
    const remainingBefore = Math.max(0, orderedQty - alreadyReceived);
    if (remainingBefore <= 0.0001) throw new Error(`Item is already fully received: ${item.itemCode || line.itemId}`);
    if (line.qty > remainingBefore + 0.0001) throw new Error(`Receipt quantity exceeds remaining PO quantity for ${item.itemCode || line.itemId}. Remaining ${remainingBefore}`);

    const itemMovements = movementsResult.rows.filter((movement: any) => String(movement.itemId || "") === line.itemId);
    const current = inventoryState(itemMovements, Number(item.defaultRate || 0));
    const poRate = weightedRate(matchingPoLines);
    const value = round2(line.qty * poRate);
    const newQty = round4(current.qty + line.qty);
    const newValue = round2(current.value + value);
    const movingAverageRate = newQty > 0 ? round4(newValue / newQty) : poRate;
    inventoryValue = round2(inventoryValue + value);

    movementsToCreate.push({
      movementId: `${receiptNumber}-${String(index + 1).padStart(3, "0")}`,
      movementDate,
      itemId: line.itemId,
      projectId: record.projectId || po.projectId || "",
      movementType: "PURCHASE_RECEIPT",
      qtyIn: line.qty,
      qtyOut: 0,
      unitCost: poRate,
      value,
      valueAdjustment: 0,
      sourceDocumentId: record.sourceDocumentId,
      journalId: "",
    });
    valuations.push({
      itemId: line.itemId,
      itemCode: item.itemCode || line.itemId,
      orderedQty,
      alreadyReceived,
      receivedNow: line.qty,
      remainingAfter: Math.max(0, remainingBefore - line.qty),
      poRate,
      previousQty: current.qty,
      previousRate: current.rate,
      newQty,
      movingAverageRate,
    });
  }

  const glLines = purchaseReceiptPosting({
    inventoryValue,
    supplierId: po.supplierId,
    projectId: record.projectId || po.projectId || "",
    inventoryAccountId: defaults.defaultInventoryAccount,
    stockReceivedButNotBilledAccountId: defaults.stockReceivedButNotBilledAccount,
  });
  const journal = await postJournal({
    postingDate: movementDate,
    documentType: "PURCHASE_RECEIPT",
    documentId: receiptNumber,
    documentNumber: receiptNumber,
    reference: `Purchase Receipt against ${po.poNumber || po.poId}`,
    projectId: record.projectId || po.projectId || "",
    lines: glLines,
  });

  try {
    const rowsWithJournal = movementsToCreate.map((movement) => ({ ...movement, journalId: journal.journalId }));
    const created = await batchAppend("StockMovements", rowsWithJournal, "purchase-receipt-ui");
    await Promise.all(valuations.map((valuation) => updateRecord(
      "Items", "itemId", valuation.itemId, { defaultRate: valuation.movingAverageRate }, "stock-valuation",
    )));

    const poItemIds = [...new Set(poLinesResult.rows.map((line: any) => String(line.itemId || "")).filter(Boolean))];
    const allFullyReceived = poItemIds.every((itemId) => {
      const item = itemMap.get(itemId);
      if (!isStockItem(item)) return true;
      const ordered = poLinesResult.rows.filter((line: any) => String(line.itemId || "") === itemId).reduce((sum: number, line: any) => sum + Number(line.qty || 0), 0);
      const nowReceived = receiptQty([...movementsResult.rows, ...rowsWithJournal], record.sourceDocumentId, itemId);
      return nowReceived + 0.0001 >= ordered;
    });
    const currentStatus = String(po.status || "").toUpperCase();
    if (!currentStatus.includes("BILL")) {
      await updateRecord("PurchaseOrders", "poId", po.poId, { status: allFullyReceived ? "RECEIVED" : "PART_RECEIVED" }, "purchase-receipt-ui");
    }

    return {
      receiptNumber,
      purchaseOrderId: record.sourceDocumentId,
      purchaseOrderNumber: po.poNumber || po.poId,
      journalId: journal.journalId,
      rows: created.rows || rowsWithJournal,
      valuations,
      inventoryValue,
    };
  } catch (error) {
    await compensateJournal({
      postingDate: movementDate,
      documentType: "PURCHASE_RECEIPT",
      documentId: receiptNumber,
      documentNumber: receiptNumber,
      projectId: record.projectId || po.projectId || "",
      lines: glLines,
      reason: `Automatic rollback because stock persistence failed for ${receiptNumber}`,
    });
    throw error;
  }
}

async function createPhysicalMovement(raw: unknown) {
  const record = movementSchema.parse(raw || {});
  await ensureAccountingInfrastructure();
  const [itemResult, defaults] = await Promise.all([
    findRecords<any>("Items", { itemId: record.itemId }, 1),
    loadConfiguredPostingAccounts(),
  ]);
  const item = itemResult.rows[0];
  if (!item) throw new Error("Item does not exist");
  if (String(item.itemType || "").toUpperCase() !== "STOCK") throw new Error("Stock movements are only allowed for STOCK items");
  if (record.projectId) {
    const project = await findRecords("Projects", { projectId: record.projectId }, 1);
    if (!project.rows.length) throw new Error("Project does not exist");
  }

  const movementRows = await findRecords<any>("StockMovements", { itemId: record.itemId }, 500);
  const current = inventoryState(movementRows.rows, Number(item.defaultRate || 0));
  const incoming = ["ADJUSTMENT_IN", "RETURN_IN"].includes(record.movementType);
  if (!incoming && record.qty > current.qty + 0.0001) throw new Error(`Insufficient stock. On hand ${current.qty}, requested ${record.qty}`);

  const effectiveUnitCost = record.movementType === "ADJUSTMENT_IN" ? Number(record.unitCost || 0) : current.rate;
  if (record.movementType === "ADJUSTMENT_IN" && !(effectiveUnitCost > 0)) throw new Error("Adjustment In requires a positive Unit Cost");
  const movementId = documentSeriesId("Movement");
  const movementDate = normalizeAccountingDate(record.movementDate);
  const value = round2(record.qty * effectiveUnitCost);
  const costAccountId = String(item.costAccount || defaults.defaultCostOfGoodsSoldAccount);

  let glLines: PostingLine[];
  if (["PROJECT_ISSUE", "RETURN_OUT"].includes(record.movementType)) {
    glLines = inventoryIssuePosting({ amount: value, costAccountId, projectId: record.projectId, description: record.movementType === "PROJECT_ISSUE" ? "Project material issue" : "Inventory return out", inventoryAccountId: defaults.defaultInventoryAccount });
  } else if (record.movementType === "RETURN_IN") {
    glLines = [
      { accountId: defaults.defaultInventoryAccount, debit: value, projectId: record.projectId, description: "Inventory returned in" },
      { accountId: costAccountId, credit: value, projectId: record.projectId, description: "Reverse prior inventory cost" },
    ];
  } else {
    glLines = inventoryAdjustmentPosting({
      amountDelta: incoming ? value : -value,
      projectId: record.projectId,
      type: record.movementType,
      costAccountId,
      inventoryAccountId: defaults.defaultInventoryAccount,
      stockAdjustmentAccountId: defaults.stockAdjustmentAccount,
      expensesIncludedInValuationAccountId: defaults.expensesIncludedInValuationAccount,
    });
  }

  const journal = await postJournal({
    postingDate: movementDate,
    documentType: `STOCK_${record.movementType}`,
    documentId: movementId,
    documentNumber: movementId,
    reference: record.sourceDocumentId || record.movementType.replaceAll("_", " "),
    projectId: record.projectId,
    lines: glLines,
  });

  try {
    const result = await appendRecord("StockMovements", {
      movementId,
      movementDate,
      itemId: record.itemId,
      projectId: record.projectId,
      movementType: record.movementType,
      qtyIn: incoming ? record.qty : 0,
      qtyOut: incoming ? 0 : record.qty,
      unitCost: round4(effectiveUnitCost),
      value,
      valueAdjustment: 0,
      sourceDocumentId: record.sourceDocumentId,
      journalId: journal.journalId,
    }, "stock-ui");

    const projectedQty = round4(incoming ? current.qty + record.qty : current.qty - record.qty);
    const projectedValue = round2(incoming ? current.value + value : current.value - value);
    const nextRate = projectedQty > 0 ? round4(projectedValue / projectedQty) : current.rate;
    await updateRecord("Items", "itemId", record.itemId, { defaultRate: Math.max(0, nextRate) }, "stock-valuation");

    return { row: result.row, journalId: journal.journalId, valuation: { previousRate: current.rate, movementUnitCost: round4(effectiveUnitCost), movingAverageRate: Math.max(0, nextRate), previousQty: current.qty, newQty: projectedQty } };
  } catch (error) {
    await compensateJournal({ postingDate: movementDate, documentType: `STOCK_${record.movementType}`, documentId: movementId, documentNumber: movementId, projectId: record.projectId, lines: glLines, reason: `Automatic rollback because stock movement persistence failed for ${movementId}` });
    throw error;
  }
}

async function createValueAdjustment(raw: unknown) {
  const record = valueAdjustmentSchema.parse(raw || {});
  await ensureAccountingInfrastructure();
  const [itemResult, defaults] = await Promise.all([
    findRecords<any>("Items", { itemId: record.itemId }, 1),
    loadConfiguredPostingAccounts(),
  ]);
  const item = itemResult.rows[0];
  if (!item) throw new Error("Item does not exist");
  if (String(item.itemType || "").toUpperCase() !== "STOCK") throw new Error("Inventory value adjustments are only allowed for STOCK items");
  const movements = await findRecords<any>("StockMovements", { itemId: record.itemId }, 500);
  const current = inventoryState(movements.rows, Number(item.defaultRate || 0));
  if (!(current.qty > 0)) throw new Error("Inventory value adjustment requires positive stock on hand");

  let delta = 0;
  if (record.adjustmentType === "LANDED_COST") {
    if (!(record.amount > 0)) throw new Error("Landed Cost amount must be greater than zero");
    delta = round2(record.amount);
  } else {
    if (!(record.targetUnitCost >= 0)) throw new Error("Target Unit Cost is required");
    if (record.adjustmentType === "NRV_WRITEDOWN" && record.targetUnitCost > current.rate + 0.0001) throw new Error("NRV write-down cannot increase inventory unit cost");
    delta = round2(current.qty * (record.targetUnitCost - current.rate));
    if (record.adjustmentType === "NRV_WRITEDOWN" && delta >= 0) throw new Error("NRV write-down must reduce inventory value");
    if (record.adjustmentType === "REVALUATION" && Math.abs(delta) < 0.005) throw new Error("Revaluation does not change inventory value");
  }

  const movementId = documentSeriesId("Value Adjustment");
  const movementDate = normalizeAccountingDate(record.movementDate);
  const glLines = inventoryAdjustmentPosting({
    amountDelta: delta,
    projectId: record.projectId,
    type: record.adjustmentType,
    costAccountId: String(item.costAccount || defaults.defaultCostOfGoodsSoldAccount),
    inventoryAccountId: defaults.defaultInventoryAccount,
    stockAdjustmentAccountId: defaults.stockAdjustmentAccount,
    expensesIncludedInValuationAccountId: defaults.expensesIncludedInValuationAccount,
  });
  const journal = await postJournal({
    postingDate: movementDate,
    documentType: `INVENTORY_${record.adjustmentType}`,
    documentId: movementId,
    documentNumber: movementId,
    reference: record.sourceDocumentId || record.adjustmentType.replaceAll("_", " "),
    projectId: record.projectId,
    lines: glLines,
  });

  try {
    const newValue = round2(current.value + delta);
    if (newValue < -0.005) throw new Error("Inventory adjustment would create a negative inventory value");
    const nextRate = round4(Math.max(0, newValue / current.qty));
    const result = await appendRecord("StockMovements", {
      movementId,
      movementDate,
      itemId: record.itemId,
      projectId: record.projectId,
      movementType: record.adjustmentType,
      qtyIn: 0,
      qtyOut: 0,
      unitCost: nextRate,
      value: Math.abs(delta),
      valueAdjustment: delta,
      sourceDocumentId: record.sourceDocumentId,
      journalId: journal.journalId,
    }, "stock-value-adjustment");
    await updateRecord("Items", "itemId", record.itemId, { defaultRate: nextRate }, "stock-valuation");
    return { row: result.row, journalId: journal.journalId, valuation: { previousRate: current.rate, previousValue: current.value, valueAdjustment: delta, movingAverageRate: nextRate, newValue } };
  } catch (error) {
    await compensateJournal({ postingDate: movementDate, documentType: `INVENTORY_${record.adjustmentType}`, documentId: movementId, documentNumber: movementId, projectId: record.projectId, lines: glLines, reason: `Automatic rollback because inventory value adjustment persistence failed for ${movementId}` });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; action?: "createItem" | "createMovement" | "createPurchaseReceipt" | "createValueAdjustment"; record?: unknown };
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
