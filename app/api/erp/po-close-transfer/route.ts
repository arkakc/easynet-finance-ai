import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const closeSchema = z.object({
  poId: z.string().trim().min(1),
  remarks: z.string().trim().min(5).max(500),
});

const OPEN_PO_STATUSES = new Set(["APPROVED", "PART_RECEIVED", "RECEIVED", "PART_BILLED", "CONVERTED", "BILL_CREATED", "BILLED"]);
const CLOSED_PO_STATUSES = new Set(["CLOSED", "CLOSED_PARTIAL"]);
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function pngDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pngYear() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextPoNumber() {
  return documentSeriesId("PO", Number(pngYear()));
}

async function buildState(poId: string) {
  const po = (await findRecords<any>("PurchaseOrders", { poId }, 1)).rows[0];
  if (!po || String(po.poNumber || "").toUpperCase().startsWith("SUPQ-")) throw new Error("Purchase Order not found");

  const [poLinesResult, itemsResult, movementsResult, billsResult, allBillLines, replacementsResult, closureRecords] = await Promise.all([
    findRecords<any>("POLines", { poId }, 500),
    listTable<any>("Items", 500, 0),
    findRecords<any>("StockMovements", { sourceDocumentId: poId }, 500),
    findRecords<any>("SupplierBills", { poId }, 500),
    listTable<any>("SupplierBillLines", 500, 0),
    findRecords<any>("PurchaseOrders", { sourceDocumentId: poId }, 50),
    findRecords<any>("Exceptions", { recordId: poId }, 50),
  ]);

  const itemMap = new Map(itemsResult.rows.map((row: any) => [String(row.itemId || row.itemCode || ""), row]));
  const validBillIds = new Set(billsResult.rows
    .filter((row: any) => !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase()))
    .map((row: any) => String(row.billId || "")));
  const billedByItem = new Map<string, number>();
  for (const line of allBillLines.rows) {
    if (!validBillIds.has(String(line.billId || ""))) continue;
    const itemId = String(line.itemId || "");
    billedByItem.set(itemId, (billedByItem.get(itemId) || 0) + Number(line.qty || 0));
  }
  const receivedByItem = new Map<string, number>();
  for (const movement of movementsResult.rows) {
    if (String(movement.movementType || "").toUpperCase() !== "PURCHASE_RECEIPT") continue;
    const itemId = String(movement.itemId || "");
    receivedByItem.set(itemId, (receivedByItem.get(itemId) || 0) + Number(movement.qtyIn || 0));
  }

  const grouped = new Map<string, any[]>();
  for (const line of poLinesResult.rows) {
    const itemId = String(line.itemId || "");
    if (!itemId) continue;
    grouped.set(itemId, [...(grouped.get(itemId) || []), line]);
  }

  const remainingLines: any[] = [];
  let fulfilledQty = 0;
  let remainingQty = 0;
  for (const [itemId, rows] of grouped.entries()) {
    const item = itemMap.get(itemId);
    const ordered = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const stock = String(item?.itemType || "NON_STOCK").toUpperCase() === "STOCK";
    const fulfilled = Math.min(ordered, stock ? Number(receivedByItem.get(itemId) || 0) : Number(billedByItem.get(itemId) || 0));
    const remaining = Math.max(0, ordered - fulfilled);
    fulfilledQty += fulfilled;
    remainingQty += remaining;
    if (remaining <= 0.0001) continue;

    const originalNet = rows.reduce((sum, row) => sum + Number(row.netAmount || Number(row.qty || 0) * Number(row.rate || 0)), 0);
    const originalGst = rows.reduce((sum, row) => sum + Number(row.gstAmount || 0), 0);
    const rate = ordered > 0 ? originalNet / ordered : Number(rows[0]?.rate || 0);
    const gstRate = originalNet > 0 ? originalGst / originalNet : 0;
    const netAmount = round2(remaining * rate);
    const gstAmount = round2(netAmount * gstRate);
    remainingLines.push({
      itemId,
      itemName: String(item?.itemName || rows[0]?.description || itemId),
      itemType: String(item?.itemType || "NON_STOCK").toUpperCase(),
      uom: String(item?.uom || rows[0]?.uom || "Each"),
      orderedQty: ordered,
      fulfilledQty: fulfilled,
      remainingQty: remaining,
      rate: round2(rate),
      netAmount,
      gstAmount,
      totalAmount: round2(netAmount + gstAmount),
    });
  }

  const replacement = replacementsResult.rows.find((row: any) => !String(row.poNumber || "").toUpperCase().startsWith("SUPQ-")) || null;
  const closure = closureRecords.rows
    .filter((row: any) => String(row.recordType || "") === "PurchaseOrderClosure")
    .sort((a: any, b: any) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;

  return {
    po,
    status: String(po.status || "").toUpperCase(),
    fulfilledQty,
    remainingQty,
    hasPartialFulfillment: fulfilledQty > 0.0001 && remainingQty > 0.0001,
    remainingLines,
    replacement,
    closure,
  };
}

export async function GET(request: Request) {
  try {
    await requirePermission("purchase.read");
    const poId = new URL(request.url).searchParams.get("poId") || "";
    if (!poId) throw new Error("Purchase Order is required");
    return NextResponse.json({ ok: true, state: await buildState(poId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase Order close readiness failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("purchase.write");
    const input = closeSchema.parse(await request.json());
    let state = await buildState(input.poId);

    if (CLOSED_PO_STATUSES.has(state.status)) {
      return NextResponse.json({ ok: true, alreadyClosed: true, state });
    }
    if (!OPEN_PO_STATUSES.has(state.status)) throw new Error(`Purchase Order must be approved before partial-supply closure. Current status: ${state.status}`);
    if (!state.hasPartialFulfillment) throw new Error("Close & Create Remaining PO is available only after partial fulfilment, with some quantity completed and some quantity still outstanding.");
    if (!state.remainingLines.length) throw new Error("No remaining Purchase Order quantity is available for a replacement PO.");

    let replacement = state.replacement;
    if (!replacement) {
      const newPoId = documentSeriesId("PO", Number(pngYear()));
      const newPoNumber = await nextPoNumber();
      const netAmount = round2(state.remainingLines.reduce((sum: number, row: any) => sum + Number(row.netAmount || 0), 0));
      const gstAmount = round2(state.remainingLines.reduce((sum: number, row: any) => sum + Number(row.gstAmount || 0), 0));
      const totalAmount = round2(netAmount + gstAmount);

      replacement = (await appendRecord("PurchaseOrders", {
        poId: newPoId,
        poNumber: newPoNumber,
        supplierId: state.po.supplierId,
        projectId: state.po.projectId,
        poDate: pngDate(),
        netAmount,
        gstAmount,
        totalAmount,
        status: "DRAFT",
        sourceDocumentId: input.poId,
      }, "partial-supply-transfer")).row;

      await batchAppend("POLines", state.remainingLines.map((row: any, index: number) => ({
        poLineId: `${newPoId}-${String(index + 1).padStart(3, "0")}`,
        poId: newPoId,
        lineNo: index + 1,
        itemId: row.itemId,
        description: row.itemName,
        qty: row.remainingQty,
        uom: row.uom,
        rate: row.rate,
        netAmount: row.netAmount,
        gstAmount: row.gstAmount,
        totalAmount: row.totalAmount,
      })), "partial-supply-transfer");
    }

    if (!state.closure) {
      await appendRecord("Exceptions", {
        exceptionId: documentSeriesId("PC", Number(pngYear())),
        severity: "INFO",
        module: "PURCHASE",
        recordType: "PurchaseOrderClosure",
        recordId: input.poId,
        message: input.remarks,
        status: "CLOSED",
        assignedTo: "Purchase Team",
        createdAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
        resolution: `Remaining supply transferred to ${replacement.poNumber || replacement.poId}`,
      }, "partial-supply-transfer");
    }

    await updateRecord("PurchaseOrders", "poId", input.poId, { status: "CLOSED_PARTIAL" }, "partial-supply-transfer");
    state = await buildState(input.poId);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Purchase Order close failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
