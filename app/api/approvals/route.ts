import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { env } from "@/lib/env";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { POST as legacyTransactionPost } from "@/app/api/transactions/route";
import { assertCustomerCreditPolicy } from "@/lib/accounting/customer-credit-control";
import { isCreditNote, postSalesCreditNote } from "@/lib/accounting/sales-return";
import { prisma } from "@/src/lib/prisma";

const actionSchema = z.object({
  recordType: z.enum(["quote", "invoice", "purchaseOrder", "supplierBill", "payment", "expense"]),
  recordId: z.string().trim().min(1),
  decision: z.enum(["APPROVE", "CANCEL"]),
  note: z.string().trim().optional().default(""),
});

const CONFIG = {
  quote: { table: "Quotes", idField: "quoteId", label: "Sales Quotation" },
  invoice: { table: "Invoices", idField: "invoiceId", label: "Sales Invoice / Credit Note" },
  purchaseOrder: { table: "PurchaseOrders", idField: "poId", label: "Purchase Document" },
  supplierBill: { table: "SupplierBills", idField: "billId", label: "Supplier Invoice" },
  payment: { table: "Payments", idField: "paymentId", label: "Payment Entry / Receipt" },
  expense: { table: "Expenses", idField: "expenseId", label: "Expense" },
} as const;

const ACCOUNTING_TYPES = new Set(["invoice", "supplierBill", "expense"]);

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}
const isDraft = (value: unknown) => String(value || "").trim().toUpperCase() === "DRAFT";
const explicitlyFalse = (value: unknown) => ["false", "0", "no", "off"].includes(String(value ?? "").trim().toLowerCase());
const createdValue = (value: unknown) => { const time = new Date(String(value || "")).getTime(); return Number.isFinite(time) ? time : 0; };

async function assertSalesInvoiceStockPolicy(invoice: any) {
  const [lines, items] = await Promise.all([
    findRecords<any>("InvoiceLines", { invoiceId: invoice.invoiceId }, 500),
    listTable<any>("Items", 500, 0),
  ]);
  const itemMap = new Map(items.rows.map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
  const hasStock = lines.rows.some((line: any) => String(itemMap.get(String(line.itemId || ""))?.itemType || "").toUpperCase() === "STOCK");
  if (hasStock && explicitlyFalse(invoice.updateStock)) {
    throw new Error("Stock Sales Invoice cannot be approved with Update Stock disabled while Delivery Note is not enabled. Enable Update Stock so Moving Average COGS and Inventory are posted together.");
  }
  if (hasStock && String(invoice.updateStock ?? "").trim() === "") {
    await updateRecord("Invoices", "invoiceId", invoice.invoiceId, { updateStock: true }, "finance-controller:stock-policy-default");
  }
}

async function assertSalesInvoiceAdvanceWorkflow(invoice: any) {
  const customerId = String(invoice.customerId || "").trim();
  if (!customerId) return;

  let sourceQuoteId = String(invoice.sourceQuoteId || "").trim();
  const sourceDocumentId = String(invoice.sourceSalesOrderId || invoice.salesOrderId || invoice.sourceDocumentId || "").trim();

  if (!sourceQuoteId && sourceDocumentId) {
    const source = (await findRecords<any>("Quotes", { quoteId: sourceDocumentId }, 1)).rows[0];
    if (source) {
      const sourceNumber = String(source.quoteNumber || "").toUpperCase();
      sourceQuoteId = sourceNumber.startsWith("SO-")
        ? String(source.sourceDocumentId || source.sourceQuoteId || source.salesQuoteId || "").trim()
        : sourceDocumentId;
    }
  }
  if (!sourceQuoteId) return;

  const payments = await listTable<any>("Payments", 500, 0);
  const linked = payments.rows.filter((row: any) => {
    const status = String(row.status || "DRAFT").toUpperCase();
    if (["CANCELLED", "REVERSED"].includes(status)) return false;
    if (String(row.partyType || "") !== "Customer") return false;
    if (String(row.paymentType || "").toUpperCase() !== "RECEIVE") return false;
    if (String(row.partyId || "") !== customerId) return false;
    const sourceId = String(row.sourceDocumentId || "").trim();
    const reference = String(row.reference || "");
    return sourceId === sourceQuoteId || reference.startsWith(`SQ:${sourceQuoteId}|`);
  });

  const unfinished = linked.find((row: any) => {
    const status = String(row.status || "DRAFT").toUpperCase();
    const journalId = String(row.journalId || "").trim();
    return status === "DRAFT" || status === "APPROVED" || !journalId;
  });
  if (!unfinished) return;

  const paymentNo = String(unfinished.paymentNumber || unfinished.paymentId || "linked Customer Advance");
  const paymentStatus = String(unfinished.status || "DRAFT").toUpperCase();
  throw new Error(
    `Cannot approve Sales Invoice while linked Customer Advance ${paymentNo} is still ${paymentStatus} / not finalized. Finalize the advance receipt first, or cancel it if it should not be used.`,
  );
}

async function assertSupplierInvoiceAdvanceWorkflow(bill: any) {
  const poId = String(bill.poId || bill.orderId || bill.sourceDocumentId || "").trim();
  const supplierId = String(bill.supplierId || "").trim();
  if (!poId || !supplierId) return;

  const payments = await listTable<any>("Payments", 500, 0);
  const linked = payments.rows.filter((row: any) => {
    const status = String(row.status || "DRAFT").toUpperCase();
    if (["CANCELLED", "REVERSED"].includes(status)) return false;
    if (String(row.partyType || "") !== "Supplier") return false;
    if (String(row.paymentType || "").toUpperCase() !== "PAY") return false;
    if (String(row.partyId || "") !== supplierId) return false;
    const sourceId = String(row.sourceDocumentId || "").trim();
    const reference = String(row.reference || "");
    return sourceId === poId || reference.startsWith(`PO:${poId}|`);
  });

  const unfinished = linked.find((row: any) => {
    const status = String(row.status || "DRAFT").toUpperCase();
    const journalId = String(row.journalId || "").trim();
    return status === "DRAFT" || status === "APPROVED" || !journalId;
  });
  if (!unfinished) return;

  const paymentNo = String(unfinished.paymentNumber || unfinished.paymentId || "linked Supplier Advance");
  const paymentStatus = String(unfinished.status || "DRAFT").toUpperCase();
  throw new Error(
    `Cannot approve Supplier Invoice while linked Supplier Advance ${paymentNo} is still ${paymentStatus} / not finalized. Finalize the advance payment first, or cancel it if it should not be used.`,
  );
}

export async function GET() {
  try {
    await requirePermission("post.approve");
    const [quotes, invoices, purchaseOrders, supplierBills, payments, expenses, manualJournals] = await Promise.all([
      listTable<any>("Quotes", 500, 0), listTable<any>("Invoices", 500, 0), listTable<any>("PurchaseOrders", 500, 0),
      listTable<any>("SupplierBills", 500, 0), listTable<any>("Payments", 500, 0), listTable<any>("Expenses", 500, 0),
      prisma.journalHeader.findMany({
        where: {
          status: "PENDING",
          sourceDocType: { startsWith: "MANUAL_" },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const pending = [
      ...quotes.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales", documentType: "Sales Quotation", documentNo: r.quoteNumber || r.quoteId, recordId: r.quoteId, status: "DRAFT", party: r.customerId || "", project: r.projectId || "", date: r.quoteDate || "", createdAt: r.createdAt || "", amount: r.totalAmount || 0, href: `/transactions/quote/${r.quoteId}`, approvalRecordType: "quote" })),
      ...invoices.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales", documentType: isCreditNote(r) ? "Sales Credit Note / Return" : "Sales Invoice", documentNo: r.invoiceNumber || r.invoiceId, recordId: r.invoiceId, status: "DRAFT", party: r.customerId || "", project: r.projectId || "", date: r.invoiceDate || "", createdAt: r.createdAt || "", amount: r.totalAmount || 0, href: `/transactions/invoice/${r.invoiceId}`, approvalRecordType: "invoice" })),
      ...purchaseOrders.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase", documentType: String(r.poNumber || "").startsWith("SUPQ-") ? "Supplier Quotation" : "Purchase Order", documentNo: r.poNumber || r.poId, recordId: r.poId, status: "DRAFT", party: r.supplierId || "", project: r.projectId || "", date: r.poDate || "", createdAt: r.createdAt || "", amount: r.totalAmount || 0, href: `/transactions/purchaseOrder/${r.poId}`, approvalRecordType: "purchaseOrder" })),
      ...supplierBills.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase", documentType: "Supplier Invoice", documentNo: r.billNumber || r.billId, recordId: r.billId, status: "DRAFT", party: r.supplierId || "", project: r.projectId || "", date: r.billDate || "", createdAt: r.createdAt || "", amount: r.totalAmount || 0, href: `/transactions/supplierBill/${r.billId}`, approvalRecordType: "supplierBill" })),
      ...payments.rows.filter((r) => isDraft(r.status) && ["Customer", "Supplier"].includes(String(r.partyType || ""))).map((r) => ({ module: String(r.partyType) === "Customer" ? "Sales" : "Purchase", documentType: String(r.partyType) === "Customer" ? "Sales Payment Entry / Receipt" : "Purchase Payment Entry / Receipt", documentNo: r.paymentNumber || r.paymentId, recordId: r.paymentId, status: "DRAFT", party: r.partyId || "", project: r.projectId || "", date: r.paymentDate || "", createdAt: r.createdAt || "", amount: r.amount || 0, href: `/transactions/payment/${r.paymentId}`, approvalRecordType: "payment" })),
      ...expenses.rows.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase", documentType: "Expense", documentNo: r.expenseNumber || r.expenseId, recordId: r.expenseId, status: "DRAFT", party: r.supplierId || "", project: r.projectId || "", date: r.expenseDate || "", createdAt: r.createdAt || "", amount: r.totalAmount || r.netAmount || 0, href: `/transactions/expense/${r.expenseId}`, approvalRecordType: "expense" })),
      ...manualJournals.map((r) => ({
        module: "Accounts",
        documentType: "Manual Journal",
        documentNo: r.code,
        recordId: r.id,
        status: "PENDING",
        party: "",
        project: "",
        date: r.date.toISOString().slice(0, 10),
        createdAt: r.createdAt.toISOString(),
        amount: Number(r.totalDebit || 0),
        href: `/journals/${r.code}`,
        approvalRecordType: "manualJournal",
      })),
    ].sort((a, b) => createdValue(b.createdAt || b.date) - createdValue(a.createdAt || a.date));
    return NextResponse.json({ ok: true, pending });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval queue load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; payload?: unknown };
    requireSecret(body.secret);
    const input = actionSchema.parse(body.payload || {});
    const config = CONFIG[input.recordType];
    const row = (await findRecords<any>(config.table, { [config.idField]: input.recordId }, 1)).rows[0];
    if (!row) throw new Error(`${config.label} not found`);
    const current = String(row.status || "DRAFT").toUpperCase();
    if (input.decision === "APPROVE" && current !== "DRAFT") throw new Error(`Only DRAFT documents can be approved. Current status: ${current}`);
    if (input.decision === "CANCEL") {
      const unpostedApprovedPayment = input.recordType === "payment" && current === "APPROVED" && !String(row.journalId || "").trim();
      if (current !== "DRAFT" && !unpostedApprovedPayment) throw new Error(`Cancellation blocked for ${current} document. Posted payments require controlled accounting reversal.`);
      if (input.recordType === "payment" && String(row.journalId || "").trim()) throw new Error("Posted Payment Entry cannot be cancelled without GL and bank reversal.");
      if (!input.note.trim()) throw new Error("A cancellation reason is required.");
    }

    if (input.decision === "CANCEL") {
      const cancelled = await updateRecord(config.table, config.idField, input.recordId, { status: "CANCELLED" }, `finance-controller:${input.note || "cancel"}`);
      return NextResponse.json({ ok: true, recordType: input.recordType, recordId: input.recordId, previousStatus: current, status: "CANCELLED", row: cancelled.row });
    }

    const creditNote = input.recordType === "invoice" && isCreditNote(row);
    if (input.recordType === "invoice" && !creditNote) {
      await assertCustomerCreditPolicy(row);
      await assertSalesInvoiceStockPolicy(row);
      await assertSalesInvoiceAdvanceWorkflow(row);
    }
    if (input.recordType === "supplierBill") {
      await assertSupplierInvoiceAdvanceWorkflow(row);
    }

    if (creditNote) {
      // Credit Note approval, AR settlement, stock return, reason status and
      // GL posting share one Prisma transaction. No compensating DRAFT reset.
      await postSalesCreditNote(row, { approveIfDraft: true });
    } else if (ACCOUNTING_TYPES.has(input.recordType)) {
      // Approval + document/subledger mutation + GL posting are one Prisma
      // transaction. Do not pre-approve here and do not use compensating
      // status rollbacks: a posting failure rolls the approval back itself.
      const internalRequest = new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "post",
          payload: {
            recordType: input.recordType,
            recordId: input.recordId,
            approveAtomically: true,
          },
          secret: body.secret,
        }),
      });
      const postingResponse = await legacyTransactionPost(internalRequest);
      const postingBody = await postingResponse.json();
      if (!postingResponse.ok || !postingBody.ok) {
        throw new Error(postingBody.error || "Accounting posting failed during atomic approval");
      }
    } else {
      await updateRecord(
        config.table,
        config.idField,
        input.recordId,
        { status: "APPROVED" },
        `finance-controller:${input.note || "approve"}`,
      );
    }

    const finalRow = (await findRecords<any>(config.table, { [config.idField]: input.recordId }, 1)).rows[0];
    const finalStatus = String(finalRow?.status || "APPROVED").toUpperCase();
    return NextResponse.json({ ok: true, recordType: input.recordType, recordId: input.recordId, previousStatus: current, status: finalStatus, row: finalRow });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Approval action failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
