import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
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
  movementType: z.enum(["PURCHASE_RECEIPT", "PROJECT_ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "RETURN_IN", "RETURN_OUT"]),
  qty: z.coerce.number().finite().positive(),
  unitCost: z.coerce.number().finite().nonnegative().optional().default(0),
  sourceDocumentId: z.string().trim().optional().default(""),
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

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function poLineMatchesItem(line: any, item: any) {
  const itemId = String(item.itemId || "");
  const itemCode = String(item.itemCode || itemId);
  const lineItem = String(line.itemId || "");
  if (lineItem && (lineItem === itemId || lineItem === itemCode)) return true;

  const description = normalized(line.description);
  const code = normalized(itemCode);
  const name = normalized(item.itemName);
  if (!description) return false;
  if (code && (description === code || description.includes(code))) return true;
  if (name && name.length >= 4 && (description === name || description.includes(name))) return true;
  return false;
}

function weightedPoRate(lines: any[]) {
  const qty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  if (!(qty > 0)) return 0;
  const value = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.rate || 0), 0);
  return round4(value / qty);
}

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope") || "full";
    const items = await listTable<any>("Items", 500, 0);

    if (scope === "items") {
      return NextResponse.json({
        ok: true,
        items: items.rows.map((item: any) => ({ ...item, uom: String(item.uom || "Each") })),
        nextItemCode: nextItemCode(items.rows),
      });
    }

    const [movements, purchaseOrders, poLines] = await Promise.all([
      listTable("StockMovements", 500, 0),
      listTable("PurchaseOrders", 500, 0),
      listTable("POLines", 500, 0),
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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; action?: "createItem" | "createMovement"; record?: unknown };
    requireSecret(body.secret);

    if (body.action === "createItem") {
      const record = itemSchema.parse(body.record || {});
      const items = await listTable<any>("Items", 500, 0);
      const itemCode = nextItemCode(items.rows);
      const byCode = await findRecords("Items", { itemCode }, 1);
      if (byCode.rows.length) throw new Error(`Generated item code already exists: ${itemCode}. Refresh and try again.`);

      const result = await appendRecord(
        "Items",
        {
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
        },
        "stock-ui",
      );
      return NextResponse.json({ ok: true, row: result.row });
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
      const onHand = current.qty;
      const incoming = ["PURCHASE_RECEIPT", "ADJUSTMENT_IN", "RETURN_IN"].includes(record.movementType);
      if (!incoming && record.qty > onHand + 0.0001) {
        throw new Error(`Insufficient stock. On hand ${onHand}, requested ${record.qty}`);
      }

      let effectiveUnitCost = incoming ? record.unitCost : current.rate;

      if (record.movementType === "PURCHASE_RECEIPT") {
        if (!record.sourceDocumentId) throw new Error("Purchase receipt requires a source PO ID");
        const po = await findRecords<any>("PurchaseOrders", { poId: record.sourceDocumentId }, 1);
        const poRow = po.rows[0];
        if (!poRow) throw new Error("Purchase receipt source must be a valid PO ID");
        if (!["APPROVED", "PART_RECEIVED", "RECEIVED", "BILL_CREATED", "BILLED"].includes(String(poRow.status || "").toUpperCase())) {
          throw new Error("Purchase receipt requires an approved purchase order");
        }
        if (record.projectId && String(poRow.projectId || "") !== record.projectId) {
          throw new Error("Purchase receipt project does not match the purchase order");
        }

        const poLines = await findRecords<any>("POLines", { poId: record.sourceDocumentId }, 500);
        const matchingLines = poLines.rows.filter((line: any) => poLineMatchesItem(line, itemRow));
        const orderedQty = matchingLines.reduce((sum: number, line: any) => sum + Number(line.qty || 0), 0);
        if (orderedQty <= 0) throw new Error("Item is not present on the purchase order. Link the PO line to this Item Master record.");

        const alreadyReceived = movements.rows
          .filter((row: any) => row.movementType === "PURCHASE_RECEIPT" && String(row.sourceDocumentId || "") === record.sourceDocumentId)
          .reduce((sum: number, row: any) => sum + Number(row.qtyIn || 0), 0);
        if (alreadyReceived + record.qty > orderedQty + 0.0001) {
          throw new Error(`Purchase receipt exceeds ordered quantity. Ordered ${orderedQty}, already received ${alreadyReceived}`);
        }

        effectiveUnitCost = weightedPoRate(matchingLines);
      }

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
      const nextRate = incoming
        ? (projectedQty > 0 ? projectedValue / projectedQty : effectiveUnitCost)
        : current.rate;

      await updateRecord(
        "Items",
        "itemId",
        record.itemId,
        { defaultRate: round4(Math.max(0, nextRate)) },
        "stock-valuation",
      );

      return NextResponse.json({
        ok: true,
        row: result.row,
        valuation: {
          previousRate: current.rate,
          movementUnitCost: round4(effectiveUnitCost),
          movingAverageRate: round4(Math.max(0, nextRate)),
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
