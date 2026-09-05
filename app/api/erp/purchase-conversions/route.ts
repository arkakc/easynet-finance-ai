import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";

function pngDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function nextPoNumber() {
  const year = new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
  const prefix = `PO-${year}-`;
  const rows = await listTable<any>("PurchaseOrders", 500, 0);
  const max = rows.rows.reduce((current, row) => {
    const value = String(row.poNumber || "");
    if (!value.startsWith(prefix)) return current;
    const sequence = Number(value.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > current ? sequence : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

export async function POST(request: Request) {
  try {
    await requirePermission("purchase.write");
    const body = await request.json() as { supplierQuoteId?: string };
    const supplierQuoteId = String(body.supplierQuoteId || "").trim();
    if (!supplierQuoteId) throw new Error("Supplier quotation is required");

    const sourceResult = await findRecords<any>("PurchaseOrders", { poId: supplierQuoteId }, 1);
    const source = sourceResult.rows[0];
    if (!source || !String(source.poNumber || "").startsWith("SUPQ-")) throw new Error("Supplier quotation not found");

    const sourceStatus = String(source.status || "DRAFT").toUpperCase();
    if (!["APPROVED", "CONVERTED"].includes(sourceStatus)) throw new Error("Supplier quotation must be APPROVED before conversion");

    const existing = await findRecords<any>("PurchaseOrders", { sourceDocumentId: supplierQuoteId }, 10);
    const existingPo = existing.rows.find((row: any) => !String(row.poNumber || "").startsWith("SUPQ-"));
    if (existingPo) {
      return NextResponse.json({ ok: true, createdId: existingPo.poId, documentNumber: existingPo.poNumber, status: "already-converted" });
    }

    const lines = await findRecords<any>("POLines", { poId: supplierQuoteId }, 500);
    if (!lines.rows.length) throw new Error("Supplier quotation has no lines");

    const year = new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
    const poId = `PO-${year}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const poNumber = await nextPoNumber();

    await appendRecord("PurchaseOrders", {
      poId,
      poNumber,
      supplierId: source.supplierId,
      projectId: source.projectId || "",
      poDate: pngDate(),
      netAmount: source.netAmount,
      gstAmount: source.gstAmount,
      totalAmount: source.totalAmount,
      status: "DRAFT",
      sourceDocumentId: supplierQuoteId,
    }, "supplier-quote-conversion");

    await batchAppend("POLines", lines.rows.map((line: any, index: number) => ({
      poLineId: `${poId}-${String(index + 1).padStart(3, "0")}`,
      poId,
      lineNo: index + 1,
      itemId: line.itemId || "",
      description: line.description,
      qty: line.qty,
      uom: line.uom,
      rate: line.rate,
      netAmount: line.netAmount,
      gstAmount: line.gstAmount,
      totalAmount: line.totalAmount,
    })), "supplier-quote-conversion");

    await updateRecord("PurchaseOrders", "poId", supplierQuoteId, { status: "CONVERTED" }, "supplier-quote-conversion");

    return NextResponse.json({ ok: true, createdId: poId, documentNumber: poNumber, status: "created" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase conversion failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
