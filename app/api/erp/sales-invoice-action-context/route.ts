import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";

export async function GET(request: Request) {
  try {
    await requirePermission("sales.read");
    const invoiceId = new URL(request.url).searchParams.get("invoiceId")?.trim() || "";
    if (!invoiceId) throw new Error("Sales Invoice is required");

    const result = await findRecords<any>("Invoices", { invoiceId }, 1);
    const invoice = result.rows[0];
    if (!invoice) return NextResponse.json({ ok: false, error: "Sales Invoice not found" }, { status: 404 });

    const sourceDocumentId = String(invoice.sourceDocumentId || "").trim();
    let sourceQuoteId = String(invoice.sourceQuoteId || "").trim();
    let sourceSalesOrderId = String(invoice.sourceSalesOrderId || invoice.salesOrderId || "").trim();

    if (!sourceQuoteId && sourceDocumentId) {
      const sourceResult = await findRecords<any>("Quotes", { quoteId: sourceDocumentId }, 1);
      const source = sourceResult.rows[0];
      if (source) {
        const sourceNumber = String(source.quoteNumber || "").toUpperCase();
        if (sourceNumber.startsWith("SO-")) {
          sourceSalesOrderId = sourceSalesOrderId || sourceDocumentId;
          sourceQuoteId = String(source.sourceDocumentId || "").trim();
        } else {
          sourceQuoteId = sourceDocumentId;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      invoice: {
        invoiceId: String(invoice.invoiceId || invoiceId),
        invoiceNumber: String(invoice.invoiceNumber || invoice.invoiceId || invoiceId),
        customerId: String(invoice.customerId || ""),
        projectId: String(invoice.projectId || ""),
        invoiceDate: String(invoice.invoiceDate || ""),
        dueDate: String(invoice.dueDate || ""),
        totalAmount: Number(invoice.totalAmount || 0),
        paidAmount: Number(invoice.paidAmount || 0),
        outstandingAmount: Number(invoice.outstandingAmount ?? invoice.totalAmount ?? 0),
        status: String(invoice.status || "DRAFT"),
        sourceDocumentId,
        sourceQuoteId,
        sourceSalesOrderId,
        journalId: String(invoice.journalId || ""),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Sales Invoice action context";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
