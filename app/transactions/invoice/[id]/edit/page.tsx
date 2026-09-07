import { notFound } from "next/navigation";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { requirePermission } from "@/lib/auth";
import DraftSalesInvoiceEditor from "@/app/components/draft-sales-invoice-editor";

export default async function EditDraftSalesInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.write");
  const { id } = await params;

  const [invoiceResult, lineResult, itemResult] = await Promise.all([
    findRecords<any>("Invoices", { invoiceId: id }, 1),
    findRecords<any>("InvoiceLines", { invoiceId: id }, 500),
    listTable<any>("Items", 500, 0),
  ]);

  const invoice = invoiceResult.rows[0];
  if (!invoice) notFound();
  if (String(invoice.status || "DRAFT").toUpperCase() !== "DRAFT" || String(invoice.journalId || "").trim()) {
    notFound();
  }

  const customer = invoice.customerId
    ? (await findRecords<any>("Customers", { customerId: invoice.customerId }, 1)).rows[0]
    : null;
  const customerLabel = customer
    ? `${customer.customerName || customer.customerId} (${customer.customerId})`
    : String(invoice.customerId || "");

  return <DraftSalesInvoiceEditor
    invoice={{
      invoiceId: String(invoice.invoiceId),
      invoiceNumber: String(invoice.invoiceNumber || invoice.invoiceId),
      customerId: String(invoice.customerId || ""),
      projectId: String(invoice.projectId || ""),
      invoiceDate: String(invoice.invoiceDate || ""),
      dueDate: String(invoice.dueDate || ""),
      netAmount: invoice.netAmount,
      gstAmount: invoice.gstAmount,
    }}
    customerLabel={customerLabel}
    sourceLines={lineResult.rows || []}
    items={itemResult.rows || []}
  />;
}
