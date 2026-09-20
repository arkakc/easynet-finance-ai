import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { inventoryState, round2, round4 } from "@/lib/accounting/inventory";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { inventoryIssuePosting, postJournal, type PostingLine } from "@/lib/accounting/posting";

const schema = z.object({
  salesOrderId: z.string().trim().min(1),
  deliveryDate: z.string().trim().min(8),
});

function year() {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date()));
}

function itemType(item: any) {
  const value = String(item?.itemType || "STOCK").toUpperCase();
  return value === "GOOD" ? "STOCK" : value === "NON_INVENTORY" ? "NON_STOCK" : value;
}

function deliveredQty(rows: any[], salesOrderId: string, itemId: string) {
  return rows
    .filter((movement: any) => String(movement.sourceDocumentId || "") === salesOrderId
      && String(movement.itemId || "") === itemId
      && String(movement.movementType || "") === "SALES_DELIVERY")
    .reduce((sum: number, movement: any) => sum + Number(movement.qtyOut || 0), 0);
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = schema.parse(await request.json());
    await ensureAccountingInfrastructure();

    const [orderResult, orderLinesResult, itemsResult, movementsResult, defaults] = await Promise.all([
      findRecords<any>("Quotes", { quoteId: input.salesOrderId }, 1),
      findRecords<any>("QuoteLines", { quoteId: input.salesOrderId }, 500),
      listTable<any>("Items", 500, 0),
      listTable<any>("StockMovements", 500, 0),
      loadConfiguredPostingAccounts(),
    ]);
    const order = orderResult.rows[0];
    if (!order || !String(order.quoteNumber || "").toUpperCase().startsWith("SO-")) throw new Error("Delivery Note source must be a valid Sales Order");
    const status = String(order.status || "").toUpperCase();
    if (!["APPROVED", "PART_DELIVERED"].includes(status)) throw new Error(`Delivery Note can only be created from an approved Sales Order. Current status: ${status}`);

    const itemMap = new Map((itemsResult.rows || []).map((item: any) => [String(item.itemId || ""), item]));
    const stockLines = (orderLinesResult.rows || [])
      .filter((line: any) => itemType(itemMap.get(String(line.itemId || ""))) === "STOCK")
      .sort((a: any, b: any) => Number(a.lineNo || 0) - Number(b.lineNo || 0));

    if (!stockLines.length) {
      await updateRecord("Quotes", "quoteId", input.salesOrderId, { status: "DELIVERED" }, "sales-delivery-note");
      console.info("sales-delivery-note.no-stock", { salesOrderId: input.salesOrderId });
      return NextResponse.json({ ok: true, noStock: true, salesOrderId: input.salesOrderId, status: "DELIVERED", message: "Sales Order has no stock lines; delivery control marked as complete." });
    }

    const deliveryNumber = documentSeriesId("DN", year());
    const movementsToCreate: any[] = [];
    const glLines: PostingLine[] = [];
    const valuationUpdates: Array<{ itemId: string; nextRate: number }> = [];

    for (let index = 0; index < stockLines.length; index += 1) {
      const line = stockLines[index];
      const itemId = String(line.itemId || "");
      const item = itemMap.get(itemId);
      if (!item) throw new Error(`Item Master record not found: ${itemId}`);
      const ordered = Number(line.qty || 0);
      const deliveredBefore = deliveredQty(movementsResult.rows || [], input.salesOrderId, itemId);
      const remaining = Math.max(0, ordered - deliveredBefore);
      if (remaining <= 0.0001) continue;

      const current = inventoryState((movementsResult.rows || []).filter((movement: any) => String(movement.itemId || "") === itemId), Number(item.defaultRate || 0));
      if (remaining > current.qty + 0.0001) throw new Error(`Insufficient stock for ${item.itemCode || itemId}. On hand ${current.qty}, delivery required ${remaining}`);
      const value = round2(remaining * current.rate);
      const projectId = String(order.projectId || "");
      glLines.push(...inventoryIssuePosting({
        amount: value,
        costAccountId: String(item.costAccount || defaults.defaultCostOfGoodsSoldAccount),
        projectId,
        description: `Delivery Note COGS: ${line.description || item.itemName || itemId}`,
        inventoryAccountId: defaults.defaultInventoryAccount,
      }));
      movementsToCreate.push({
        movementId: `${deliveryNumber}-${String(index + 1).padStart(3, "0")}`,
        movementDate: input.deliveryDate,
        itemId,
        projectId,
        movementType: "SALES_DELIVERY",
        qtyIn: 0,
        qtyOut: remaining,
        unitCost: current.rate,
        value,
        valueAdjustment: 0,
        sourceDocumentId: input.salesOrderId,
        journalId: "",
      });
      const nextQty = round4(current.qty - remaining);
      const nextValue = round2(current.value - value);
      valuationUpdates.push({ itemId, nextRate: nextQty > 0 ? round4(nextValue / nextQty) : current.rate });
    }

    if (!movementsToCreate.length) throw new Error("All stock lines are already delivered for this Sales Order");
    const journal = await postJournal({
      postingDate: input.deliveryDate,
      documentType: "SALES_DELIVERY_NOTE",
      documentId: deliveryNumber,
      documentNumber: deliveryNumber,
      reference: `Delivery Note against ${order.quoteNumber || order.quoteId}`,
      projectId: order.projectId || "",
      lines: glLines,
    });
    const rowsWithJournal = movementsToCreate.map((movement) => ({ ...movement, journalId: journal.journalId }));
    const result = await batchAppend("StockMovements", rowsWithJournal, "sales-delivery-note");
    await Promise.all(valuationUpdates.map((valuation) => updateRecord("Items", "itemId", valuation.itemId, { defaultRate: Math.max(0, valuation.nextRate) }, "sales-delivery-note")));

    const combinedMovements = [...(movementsResult.rows || []), ...rowsWithJournal];
    const fullyDelivered = stockLines.every((line: any) =>
      deliveredQty(combinedMovements, input.salesOrderId, String(line.itemId || "")) + 0.0001 >= Number(line.qty || 0),
    );
    await updateRecord("Quotes", "quoteId", input.salesOrderId, { status: fullyDelivered ? "DELIVERED" : "PART_DELIVERED" }, "sales-delivery-note");

    console.info("sales-delivery-note.posted", { salesOrderId: input.salesOrderId, deliveryNumber, journalId: journal.journalId, movementCount: rowsWithJournal.length, fullyDelivered });
    return NextResponse.json({ ok: true, deliveryNumber, salesOrderId: input.salesOrderId, journalId: journal.journalId, rows: result.rows || rowsWithJournal, status: fullyDelivered ? "DELIVERED" : "PART_DELIVERED" });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Delivery Note failed";
    console.error("sales-delivery-note.failed", { message });
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
