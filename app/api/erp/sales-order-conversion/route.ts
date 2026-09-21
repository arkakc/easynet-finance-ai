import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const schema = z.object({
  quoteId: z.string().trim().min(1),
  orderDate: z.string().trim().min(8),
});

function year() {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date()));
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = schema.parse(await request.json());
    const [quoteResult, quoteLinesResult, existingOrders, allQuotes] = await Promise.all([
      findRecords<any>("Quotes", { quoteId: input.quoteId }, 1),
      findRecords<any>("QuoteLines", { quoteId: input.quoteId }, 500),
      findRecords<any>("Quotes", { sourceDocumentId: input.quoteId }, 50),
      listTable<any>("Quotes", 500, 0),
    ]);

    const quote = quoteResult.rows[0];
    if (!quote) throw new Error("Sales Quotation not found");
    if (String(quote.quoteNumber || "").toUpperCase().startsWith("SO-")) throw new Error("This document is already a Sales Order");
    const directlyLinked = (existingOrders.rows || []).find((row: any) =>
      String(row.quoteNumber || "").toUpperCase().startsWith("SO-")
      && !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase()),
    );
    const legacyMatches = (allQuotes.rows || []).filter((row: any) =>
      String(row.quoteNumber || "").toUpperCase().startsWith("SO-")
      && !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase())
      && String(row.customerId || "") === String(quote.customerId || "")
      && String(row.projectId || "") === String(quote.projectId || "")
      && Math.abs(Number(row.totalAmount || 0) - Number(quote.totalAmount || 0)) < 0.01,
    );
    const existing = directlyLinked || (legacyMatches.length === 1 ? legacyMatches[0] : null);
    const status = String(quote.status || "").toUpperCase();
    if (existing) {
      if (!String(existing.sourceDocumentId || "")) {
        await updateRecord("Quotes", "quoteId", existing.quoteId, { sourceDocumentId: input.quoteId }, "sales-order-conversion:legacy-link-repair");
      }
      if (status !== "CONVERTED") await updateRecord("Quotes", "quoteId", input.quoteId, { status: "CONVERTED" }, "sales-order-conversion");
      console.info("sales-order-conversion.existing", { quoteId: input.quoteId, salesOrderId: existing.quoteId, repairedLegacyLink: !directlyLinked });
      return NextResponse.json({ ok: true, createdId: existing.quoteId, documentNumber: existing.quoteNumber || existing.quoteId, status: "existing-sales-order" });
    }
    if (!["APPROVED", "SENT", "ACCEPTED"].includes(status)) throw new Error(`Sales Quotation must be approved before Sales Order conversion. Current status: ${status}`);

    const lines = [...(quoteLinesResult.rows || [])].sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0));
    if (!lines.length) throw new Error("Sales Quotation has no lines");
    const temporary = lines.filter((line: any) => !String(line.itemId || "").trim());
    if (temporary.length) throw new Error("All quotation TEMP items must be saved permanently in Item Master before Sales Order conversion");

    const orderId = documentSeriesId("SO", year());
    const orderNumber = orderId;
    await appendRecord("Quotes", {
      quoteId: orderId,
      quoteNumber: orderNumber,
      customerId: quote.customerId,
      projectId: quote.projectId || "",
      quoteDate: input.orderDate,
      expiryDate: "",
      currency: String(quote.currency || "PGK"),
      exchangeRate: Number(quote.exchangeRate || 0) || undefined,
      netAmount: Number(quote.netAmount || 0),
      gstAmount: Number(quote.gstAmount || 0),
      totalAmount: Number(quote.totalAmount || 0),
      status: "DRAFT",
      sourceDocumentId: input.quoteId,
      sourceQuoteId: input.quoteId,
      salesQuoteId: input.quoteId,
    }, "sales-order-conversion");
    await batchAppend("QuoteLines", lines.map((line: any, index: number) => ({
      quoteLineId: `${orderId}-${String(index + 1).padStart(3, "0")}`,
      quoteId: orderId,
      lineNo: index + 1,
      itemId: line.itemId,
      description: line.description,
      qty: Number(line.qty || 0),
      uom: line.uom || "Each",
      rate: Number(line.rate || 0),
      netAmount: Number(line.netAmount || 0),
      gstAmount: Number(line.gstAmount || 0),
      totalAmount: Number(line.totalAmount || 0),
    })), "sales-order-conversion");
    await updateRecord("Quotes", "quoteId", input.quoteId, { status: "CONVERTED" }, "sales-order-conversion");

    console.info("sales-order-conversion.created", { quoteId: input.quoteId, salesOrderId: orderId, lineCount: lines.length });
    return NextResponse.json({ ok: true, createdId: orderId, documentNumber: orderNumber, status: "sales-order-created" });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Sales Order conversion failed";
    console.error("sales-order-conversion.failed", { message });
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
