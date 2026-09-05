import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";

const actionSchema = z.object({
  recordType: z.enum(["quote", "invoice", "purchaseOrder", "supplierBill", "payment", "expense"]),
  recordId: z.string().trim().min(1),
  decision: z.enum(["APPROVE", "CANCEL"]),
  note: z.string().trim().optional().default(""),
});

const CONFIG = {
  quote: { table: "Quotes", idField: "quoteId", label: "Sales Quotation" },
  invoice: { table: "Invoices", idField: "invoiceId", label: "Sales Invoice" },
  purchaseOrder: { table: "PurchaseOrders", idField: "poId", label: "Purchase Document" },
  supplierBill: { table: "SupplierBills", idField: "billId", label: "Supplier Bill" },
  payment: { table: "Payments", idField: "paymentId", label: "Payment / Receipt" },
  expense: { table: "Expenses", idField: "expenseId", label: "Expense" },
} as const;

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

const isDraft = (value: unknown) => String(value || "").trim().toUpperCase() === "DRAFT";

export async function GET() {
  try {
    const [quotes, invoices, purchaseOrders, supplierBills, payments, expenses] = await Promise.all([
      listTable<any>("Quotes", 500, 0),
      listTable<any>("Invoices", 500, 0),
      listTable<any>("PurchaseOrders", 500, 0),
      listTable<any>("SupplierBills", 500, 0),
      listTable<any>("Payments", 500, 0),
      listTable<any>("Expenses", 500, 0),
    ]);
    const pending = [
      ...quotes.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales", documentType: "Sales Quotation", documentNo: r.quoteNumber || r.quoteId, recordId: r.quoteId, status: "DRAFT", party: r.customerId || "", project: r.projectId || "", date: r.quoteDate || "", amount: r.totalAmount || 0, href: `/transactions/quote/${r.quoteId}`, approvalRecordType: "quote" })),
      ...invoices.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales", documentType: "Sales Invoice", documentNo: r.invoiceNumber || r.invoiceId, recordId: r.invoiceId, status: "DRAFT", party: r.customerId || "", project: r.projectId || "", date: r.invoiceDate || "", amount: r.totalAmount || 0, href: `/transactions/invoice/${r.invoiceId}`, approvalRecordType: "invoice" })),
      ...purchaseOrders.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase", documentType: String(r.poNumber || "").startsWith("SUPQ-") ? "Supplier Quotation" : "Purchase Order", documentNo: r.poNumber || r.poId, recordId: r.poId, status: "DRAFT", party: r.supplierId || "", project: r.projectId || "", date: r.poDate || "", amount: r.totalAmount || 0, href: `/transactions/purchaseOrder/${r.poId}`, approvalRecordType: "purchaseOrder" })),
      ...supplierBills.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase", documentType: "Supplier Bill", documentNo: r.billNumber || r.billId, recordId: r.billId, status: "DRAFT", party: r.supplierId || "", project: r.projectId || "", date: r.billDate || "", amount: r.totalAmount || 0, href: `/transactions/supplierBill/${r.billId}`, approvalRecordType: "supplierBill" })),
      ...payments.rows.filter((r) => isDraft(r.status) && ["Customer", "Supplier"].includes(String(r.partyType || ""))).map((r) => ({ module: String(r.partyType) === "Customer" ? "Sales" : "Purchase", documentType: String(r.partyType) === "Customer" ? "Sales Payment / Receipt" : "Purchase Payment / Receipt", documentNo: r.paymentNumber || r.paymentId, recordId: r.paymentId, status: "DRAFT", party: r.partyId || "", project: r.projectId || "", date: r.paymentDate || "", amount: r.amount || 0, href: `/transactions/payment/${r.paymentId}`, approvalRecordType: "payment" })),
      ...expenses.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase", documentType: "Expense", documentNo: r.expenseNumber || r.expenseId, recordId: r.expenseId, status: "DRAFT", party: r.supplierId || "", project: r.projectId || "", date: r.expenseDate || "", amount: r.totalAmount || r.netAmount || 0, href: `/transactions/expense/${r.expenseId}`, approvalRecordType: "expense" })),
    ];
    return NextResponse.json({ ok: true, pending });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Approval queue load failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; payload?: unknown };
    requireSecret(body.secret);
    const input = actionSchema.parse(body.payload || {});
    const config = CONFIG[input.recordType];
    const result = await findRecords<any>(config.table, { [config.idField]: input.recordId }, 1);
    const row = result.rows[0];
    if (!row) throw new Error(`${config.label} not found`);
    const current = String(row.status || "DRAFT").toUpperCase();
    if (input.decision === "APPROVE" && current !== "DRAFT") throw new Error(`Only DRAFT documents can be approved. Current status: ${current}`);
    if (input.decision === "CANCEL" && !["DRAFT", "APPROVED"].includes(current)) throw new Error(`Cannot cancel document in ${current} status`);
    const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "CANCELLED";
    const updated = await updateRecord(config.table, config.idField, input.recordId, { status: nextStatus }, `finance-controller:${input.note || input.decision.toLowerCase()}`);
    return NextResponse.json({ ok: true, recordType: input.recordType, recordId: input.recordId, previousStatus: current, status: nextStatus, row: updated.row });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ") : error instanceof Error ? error.message : "Approval action failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
