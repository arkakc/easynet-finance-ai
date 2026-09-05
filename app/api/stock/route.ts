import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

const itemSchema = z.object({
  itemId: z.string().trim().optional().default(""),
  itemCode: z.string().trim().min(1),
  itemName: z.string().trim().min(2),
  itemType: z.enum(["STOCK", "SERVICE", "NON_STOCK"]).default("STOCK"),
  revenueAccount: z.string().trim().optional().default("ACC-4200"),
  costAccount: z.string().trim().optional().default("ACC-5100"),
  defaultRate: z.coerce.number().finite().nonnegative().default(0),
  taxCode: z.string().trim().optional().default(""),
});

const movementSchema = z.object({
  movementDate: z.string().trim().min(8),
  itemId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  movementType: z.enum(["PURCHASE_RECEIPT", "PROJECT_ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "RETURN_IN", "RETURN_OUT"]),
  qty: z.coerce.number().finite().positive(),
  unitCost: z.coerce.number().finite().nonnegative().default(0),
  sourceDocumentId: z.string().trim().optional().default(""),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function GET() {
  try {
    const [items, movements] = await Promise.all([
      listTable("Items", 500, 0),
      listTable("StockMovements", 500, 0),
    ]);
    return NextResponse.json({ ok: true, items: items.rows, movements: movements.rows });
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
      const byCode = await findRecords("Items", { itemCode: record.itemCode }, 1);
      if (byCode.rows.length) throw new Error(`Item code already exists: ${record.itemCode}`);
      const itemId = record.itemId || `ITEM-${randomUUID().slice(0, 8).toUpperCase()}`;
      const result = await appendRecord("Items", { ...record, itemId, active: true }, "stock-ui");
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
      const onHand = movements.rows.reduce((sum, row) => sum + Number(row.qtyIn || 0) - Number(row.qtyOut || 0), 0);
      const incoming = ["PURCHASE_RECEIPT", "ADJUSTMENT_IN", "RETURN_IN"].includes(record.movementType);
      if (!incoming && record.qty > onHand + 0.0001) {
        throw new Error(`Insufficient stock. On hand ${onHand}, requested ${record.qty}`);
      }

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
        const orderedQty = poLines.rows
          .filter((line) => String(line.itemId || "") === record.itemId)
          .reduce((sum, line) => sum + Number(line.qty || 0), 0);
        if (orderedQty <= 0) throw new Error("Item is not present on the purchase order");

        const alreadyReceived = movements.rows
          .filter((row) => row.movementType === "PURCHASE_RECEIPT" && String(row.sourceDocumentId || "") === record.sourceDocumentId)
          .reduce((sum, row) => sum + Number(row.qtyIn || 0), 0);
        if (alreadyReceived + record.qty > orderedQty + 0.0001) {
          throw new Error(`Purchase receipt exceeds ordered quantity. Ordered ${orderedQty}, already received ${alreadyReceived}`);
        }
      }

      const movementId = `MOV-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const value = Math.round(record.qty * record.unitCost * 100) / 100;
      const result = await appendRecord("StockMovements", {
        movementId,
        movementDate: normalizeAccountingDate(record.movementDate),
        itemId: record.itemId,
        projectId: record.projectId,
        movementType: record.movementType,
        qtyIn: incoming ? record.qty : 0,
        qtyOut: incoming ? 0 : record.qty,
        unitCost: record.unitCost,
        value,
        sourceDocumentId: record.sourceDocumentId,
      }, "stock-ui");
      return NextResponse.json({ ok: true, row: result.row });
    }

    throw new Error("Unsupported stock action");
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Stock write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
