import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { resolveTransactionItems } from "@/lib/erp/item-linking";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

function pngDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function pngYear() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}
async function nextNumber(table: string, field: string, prefix: string) {
  void table;
  void field;
  return documentSeriesId(prefix, Number(pngYear()));
}

function isApprovedPurchaseLifecycle(value: unknown) {
  return ["APPROVED", "SENT"].includes(String(value || "").trim().toUpperCase());
}

async function supplierQuoteToPurchaseOrder(supplierQuoteId: string) {
  const source = (await findRecords<any>("PurchaseOrders", { poId: supplierQuoteId }, 1)).rows[0];
  if (!source || !String(source.poNumber || "").startsWith("SUPQ-")) throw new Error("Supplier quotation not found");

  const existing = await findRecords<any>("PurchaseOrders", { sourceDocumentId: supplierQuoteId }, 20);
  const existingPo = existing.rows.find((row: any) => !String(row.poNumber || "").startsWith("SUPQ-"));
  if (existingPo) {
    if (String(source.status || "").toUpperCase() !== "CONVERTED") {
      await updateRecord("PurchaseOrders", "poId", supplierQuoteId, { status: "CONVERTED" }, "supplier-quote-conversion");
    }
    return {
      createdId: existingPo.poId,
      documentNumber: existingPo.poNumber,
      status: "already-converted",
      createdType: "purchaseOrder",
    };
  }

  const sourceStatus = String(source.status || "DRAFT").toUpperCase();
  if (!isApprovedPurchaseLifecycle(sourceStatus)) throw new Error("Supplier quotation must be APPROVED before conversion");

  const sourceLines = await findRecords<any>("POLines", { poId: supplierQuoteId }, 500);
  if (!sourceLines.rows.length) throw new Error("Supplier quotation has no lines");
  const unresolved = sourceLines.rows.filter((line: any) => !String(line.itemId || "").trim());
  if (unresolved.length) {
    throw new Error(`${unresolved.length} Supplier Quotation TEMP item(s) are not permanent yet. Open the Supplier Quotation, save every TEMP item permanently in Item Master, then create the Purchase Order.`);
  }

  // Conversion is strict: Supplier Quotation item finalization is a separate,
  // user-reviewed step. PO conversion never silently creates an Item Master record.
  const resolved = await resolveTransactionItems(sourceLines.rows, {
    allowTemporary: false,
    autoCreateMissing: false,
    actor: "supplier-quote-to-po:item-linking",
    defaultNewItemType: "STOCK",
  });

  const poId = documentSeriesId("PO", Number(pngYear()));
  const poNumber = await nextNumber("PurchaseOrders", "poNumber", "PO");
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
    sourceSupplierQuoteId: supplierQuoteId,
    supplierQuoteId,
  }, "supplier-quote-conversion");

  await batchAppend("POLines", resolved.lines.map((line: any, index: number) => ({
    poLineId: `${poId}-${String(index + 1).padStart(3, "0")}`,
    poId,
    lineNo: index + 1,
    itemId: line.itemId,
    description: line.itemName || line.description,
    qty: line.qty,
    uom: line.uom,
    rate: line.rate,
    netAmount: line.netAmount,
    gstAmount: line.gstAmount,
    totalAmount: line.totalAmount,
  })), "supplier-quote-conversion");

  await updateRecord("PurchaseOrders", "poId", supplierQuoteId, { status: "CONVERTED" }, "supplier-quote-conversion");
  return {
    createdId: poId,
    documentNumber: poNumber,
    status: "created",
    createdType: "purchaseOrder",
    itemsCreated: 0,
  };
}

async function purchaseOrderToSupplierInvoice(purchaseOrderId: string) {
  const source = (await findRecords<any>("PurchaseOrders", { poId: purchaseOrderId }, 1)).rows[0];
  if (!source || String(source.poNumber || "").startsWith("SUPQ-")) throw new Error("Purchase Order not found");
  const sourceStatus = String(source.status || "DRAFT").toUpperCase();
  if (!["APPROVED", "CONVERTED"].includes(sourceStatus)) throw new Error("Purchase Order must be APPROVED before conversion");
  const existing = (await findRecords<any>("SupplierBills", { sourceDocumentId: purchaseOrderId }, 10)).rows[0];
  if (existing) {
    if (sourceStatus !== "CONVERTED") await updateRecord("PurchaseOrders", "poId", purchaseOrderId, { status: "CONVERTED" }, "supplier-invoice-conversion");
    return { createdId: existing.billId, documentNumber: existing.billNumber, status: "already-converted", createdType: "supplierBill" };
  }
  const sourceLines = await findRecords<any>("POLines", { poId: purchaseOrderId }, 500);
  if (!sourceLines.rows.length) throw new Error("Purchase Order has no lines");
  const resolved = await resolveTransactionItems(sourceLines.rows, {
    allowTemporary: false,
    autoCreateMissing: false,
    actor: "po-to-supplier-invoice:item-linking",
    defaultNewItemType: "STOCK",
  });
  const billId = documentSeriesId("Bill", Number(pngYear()));
  const billNumber = await nextNumber("SupplierBills", "billNumber", "PB");
  await appendRecord("SupplierBills", {
    billId,
    billNumber,
    supplierId: source.supplierId,
    projectId: source.projectId || "",
    billDate: pngDate(),
    dueDate: "",
    poId: purchaseOrderId,
    netAmount: source.netAmount,
    gstAmount: source.gstAmount,
    totalAmount: source.totalAmount,
    paidAmount: 0,
    outstandingAmount: source.totalAmount,
    status: "DRAFT",
    sourceDocumentId: purchaseOrderId,
    sourcePurchaseOrderId: purchaseOrderId,
    journalId: "",
  }, "supplier-invoice-conversion");
  await batchAppend("SupplierBillLines", resolved.lines.map((line: any, index: number) => ({
    billLineId: `${billId}-${String(index + 1).padStart(3, "0")}`,
    billId,
    lineNo: index + 1,
    itemId: line.itemId,
    description: line.itemName || line.description,
    qty: line.qty,
    uom: line.uom,
    rate: line.rate,
    netAmount: line.netAmount,
    gstAmount: line.gstAmount,
    totalAmount: line.totalAmount,
    costAccountId: line.costAccountId || "ACC-5100",
  })), "supplier-invoice-conversion");
  await updateRecord("PurchaseOrders", "poId", purchaseOrderId, { status: "CONVERTED" }, "supplier-invoice-conversion");
  return { createdId: billId, documentNumber: billNumber, status: "created", createdType: "supplierBill" };
}

export async function POST(request: Request) {
  try {
    await requirePermission("purchase.write");
    const body = await request.json() as { supplierQuoteId?: string; purchaseOrderId?: string };
    const supplierQuoteId = String(body.supplierQuoteId || "").trim();
    const purchaseOrderId = String(body.purchaseOrderId || "").trim();
    if (Boolean(supplierQuoteId) === Boolean(purchaseOrderId)) throw new Error("Provide either Supplier Quotation or Purchase Order for conversion");
    const result = supplierQuoteId
      ? await supplierQuoteToPurchaseOrder(supplierQuoteId)
      : await purchaseOrderToSupplierInvoice(purchaseOrderId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase conversion failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
