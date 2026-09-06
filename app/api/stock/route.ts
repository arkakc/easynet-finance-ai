import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

const itemSchema = z.object({
  itemId: z.string().trim().optional().default(""),
  itemCode: z.string().trim().optional().default(""),
  itemName: z.string().trim().min(2),
  itemType: z.enum(["STOCK", "SERVICE", "NON_STOCK"]).default("STOCK"),
  revenueAccount: z.string().trim().optional().default("ACC-4200"),
  costAccount: z.string().trim().optional().default("ACC-5100"),
  defaultRate: z.coerce.number().finite().nonnegative().optional().default(0),
  taxCode: z.string().trim().optional().default(""),
  uom: z.string().trim().min(1).default("Each"),
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

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

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

function inventoryState(rows: any[], fallbackRate = 0) {
  let qty = 0;
  let value = 0;
  for (const row of rows) {
    const qtyIn = Number(row.qtyIn || 0);
    const qtyOut = Number(row.qtyOut || 0);
    const rowValue = Math.abs(Number(row.value || 0));
    qty += qtyIn - qtyOut;
    value += qtyIn > 0 ? rowValue : -rowValue;
  }
  if (Math.abs(qty) < 0.0000001) qty = 0;
  if (Math.abs(value) < 0.005) value = 0;
  const rate = qty > 0 ? value / qty : Number(fallbackRate || 0);
  return { qty, value: round2(value), rate: round4(Math.max(0, rate)) };
}

function approvedPurchaseOrderStatus(value: unknown) {
  return ["APPROVED", "PART_RECEIVED", "CONVERTED", "BILL_CREATED", "BILLED"].includes(String(value || "").toUpperCase());
}

function weightedPoRate(lines: any[]) {
  const qty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  if (!(qty > 0)) return 0;
  const value = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.rate || 0), 0);
  return round4(value / qty);
}

function mergeReceiptLines(lines: Array<{ itemId: string; qty: number }>) {
  const merged = new Map<string, number>();
  for (const line of lines) merged.set(line.itemId, (merged.get(line.itemId) || 0) + Number(line.qty || 0));
  return [...merged.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope") || "full";

    if (scope === "items") {
      const items = await listTable<any>("Items", 500, 0);
      return NextResponse.json({
        ok: true,
        items: items.rows.map((item: any) => ({ ...item, uom: String(item.uom || "Each") })),
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
      return { ...item, uom: String(item.uom || "Each"), defaultRate: state.rate, stockQty: state.qty, stockValue: state.value };
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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stock read failed" }, { status: 500 });
  }
}

async function createPurchaseReceipt(raw: unknown) {
  const record = purchaseReceiptSchema.parse(raw || {});
  const receiptLines = mergeReceiptLines(record.lines);

  const [poResult, poLinesResult, itemsResult, movementsResult] = await Promise.all([
    findRecords<any>("PurchaseOrders", { poId: record.sourceDocumentId }, 1),
    findRecords<any>("POLines", { poId: record.sourceDocumentId }, 500),
    listTable<any>("Items", 500, 0),
    listTable<any>("StockMovements", 500, 0),
  ]);

  const po = poResult.rows[0];
  if (!po || String(po.poNumber || "").toUpperCase().startsWith("SUPQ-")) {
    throw new Error("Purchase Receipt source must be a valid Purchase Order");
  }
  if (!approvedPurchaseOrderStatus(po.status)) {
    throw new Error("Purchase Receipt can only be created from an approved Purchase Order");
  }
  if (record.projectId && String(po.projectId || "") !== record.projectId) {
    throw new Error("Purchase Receipt project does not match the Purchase Order");
  }

  const itemMap = new Map(itemsResult.rows.map((item: any) => [String(item.itemId || ""), item]));
  const receiptNumber = `PR-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const movementDate = normalizeAccountingDate(record.movementDate);

  const movementsToCreate: any[] = [];
  const valuations: any[] = [];

  for (let index = 0; index < receiptLines.length; index += 1) {
    const line = receiptLines[index];
    const item = itemMap.get(line.itemId);
    if (!item) throw new Error(`Item does not exist: ${line.itemId}`);
    if (String(item.itemType || "").toUpperCase() !== "STOCK") {
      throw new Error(`Purchase Receipt can only receive STOCK items: ${item.itemCode || line.itemId}`);
    }

    const matchingPoLines = poLinesResult.rows.filter((poLine: any) => String(poLine.itemId || "") === line.itemId);
    if (!matchingPoLines.length) {
      throw new Error(`Purchase Order item is not linked to Item Master: ${item.itemCode || line.itemId}`);
    }

    const orderedQty = matchingPoLines.reduce((sum: number, poLine: any) => sum + Number(poLine.qty || 0), 0);
    const itemMovements = movementsResult.rows.filter((movement: any) => String(movement.itemId || "") === line.itemId);
    const alreadyReceived = itemMovements
      .filter((movement: any) => movement.movementType === "PURCHASE_RECEIPT" && String(movement.sourceDocumentId || "") === record.sourceDocumentId)
      .reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
    const remainingBefore = Math.max(0, orderedQty - alreadyReceived);

    if (remainingBefore <= 0.0001) throw new Error(`Item is already fully received: ${item.itemCode || line.itemId}`);
    if (line.qty > remainingBefore + 0.0001) {
      throw new Error(`Receipt quantity exceeds remaining PO quantity for ${item.itemCode || line.itemId}. Remaining ${remainingBefore}`);
    }

    const current = inventoryState(itemMovements, Number(item.defaultRate || 0));
    const poRate = weightedPoRate(matchingPoLines);
    const value = round2(line.qty * poRate);
    const newQty = current.qty + line.qty;
    const newValue = current.value + value;
    const movingAverageRate = newQty > 0 ? round4(newValue / newQty) : poRate;

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
      sourceDocumentId: record.sourceDocumentId,
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

  const created = await batchAppend("StockMovements", movementsToCreate, "purchase-receipt-ui");

  await Promise.all(valuations.map((valuation) => updateRecord(
    "Items",
    "itemId",
    valuation.itemId,
    { defaultRate: valuation.movingAverageRate },
    "stock-valuation",
  )));

  return {
    receiptNumber,
    purchaseOrderId: record.sourceDocumentId,
    purchaseOrderNumber: po.poNumber || po.poId,
    rows: created.rows || movementsToCreate,
    valuations,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; action?: "createItem" | "createMovement" | "createPurchaseReceipt"; record?: unknown };
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
      }, "stock-ui");
      return NextResponse.json({ ok: true, row: result.row });
    }

    if (body.action === "createPurchaseReceipt") {
      const result = await createPurchaseReceipt(body.record);
      return NextResponse.json({ ok: true, ...result });
    }

    if (body.action === "createMovement") {
      const record = movementSchema.parse(body.record || {});
      const item = await findRecords<any>("Items", { itemId: record.itemId }, 1);
      const itemRow = item.rows[0];
      if (!itemRow) throw new Error("Item does not exist");
      if (String(itemRow.itemType || "").toUpperCase() !== "STOCK") {
        throw new Error("Stock movements are only allowed for STOCK items");
      }

      if (record.projectId) {
        const project = await findRecords("Projects", { projectId: record.projectId }, 1);
        if (!project.rows.length) throw new Error("Project does not exist");
      }

      const movements = await findRecords<any>("StockMovements", { itemId: record.itemId }, 500);
      const current = inventoryState(movements.rows, Number(itemRow.defaultRate || 0));
      const incoming = ["ADJUSTMENT_IN", "RETURN_IN"].includes(record.movementType);

      if (!incoming && record.qty > current.qty + 0.0001) {
        throw new Error(`Insufficient stock. On hand ${current.qty}, requested ${record.qty}`);
      }

      const effectiveUnitCost = incoming ? record.unitCost : current.rate;
      const movementId = `MOV-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const value = round2(record.qty * effectiveUnitCost);
      const result = await appendRecord("StockMovements", {
        movementId,
        movementDate: normalizeAccountingDate(record.movementDate),
        itemId: record.itemId,
        projectId: record.projectId,
        movementType: record.movementType,
        qtyIn: incoming ? record.qty : 0,
        qtyOut: incoming ? 0 : record.qty,
        unitCost: round4(effectiveUnitCost),
        value,
        sourceDocumentId: record.sourceDocumentId,
      }, "stock-ui");

      const projectedQty = incoming ? current.qty + record.qty : current.qty - record.qty;
      const projectedValue = incoming ? current.value + value : current.value - value;
      const nextRate = incoming ? (projectedQty > 0 ? projectedValue / projectedQty : effectiveUnitCost) : current.rate;

      await updateRecord("Items", "itemId", record.itemId, { defaultRate: round4(Math.max(0, nextRate)) }, "stock-valuation");

      return NextResponse.json({
        ok: true,
        row: result.row,
        valuation: {
          previousRate: current.rate,
          movementUnitCost: round4(effectiveUnitCost),
          movingAverageRate: round4(Math.max(0, nextRate)),
          previousQty: current.qty,
          newQty: projectedQty,
        },
      });
    }

    throw new Error("Unsupported stock action");
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Stock write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
