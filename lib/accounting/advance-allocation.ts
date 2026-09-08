import { randomUUID } from "node:crypto";
import { appendRecord, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { postJournal } from "@/lib/accounting/posting";
import { round2 } from "@/lib/accounting/inventory";

export type AdvancePartyType = "Customer" | "Supplier";
export type AdvanceDocumentType = "Sales Invoice" | "Supplier Invoice";

const POSTED_ALLOCATION = "POSTED";

function allocationSourceType(partyType: AdvancePartyType) {
  return partyType === "Customer" ? "CUSTOMER_ADVANCE_ALLOCATION" : "SUPPLIER_ADVANCE_ALLOCATION";
}

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function allocationRows(partyType: AdvancePartyType) {
  const rows = await listTable<any>("PaymentSchedules", 500, 0);
  return (rows.rows || []).filter((row: any) =>
    String(row.sourceType || "") === allocationSourceType(partyType)
    && String(row.status || "").toUpperCase() === POSTED_ALLOCATION,
  );
}

export async function advanceAllocationSummary(payment: any) {
  const partyType = String(payment.partyType || "") as AdvancePartyType;
  if (!(["Customer", "Supplier"] as string[]).includes(partyType)) {
    return { allocatedAmount: 0, remainingAmount: Number(payment.amount || 0), allocations: [] as any[] };
  }
  const rows = (await allocationRows(partyType)).filter((row: any) => String(row.sourceId || "") === String(payment.paymentId || ""));
  const scheduledAllocated = round2(rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
  // Backward compatibility: the old 0.5 model linked the full advance directly
  // in Payments.againstDocumentId and did not create an allocation ledger row.
  const legacyAllocated = String(payment.againstDocumentId || "").trim() && scheduledAllocated <= 0.001
    ? Number(payment.amount || 0)
    : 0;
  const allocatedAmount = round2(Math.max(scheduledAllocated, legacyAllocated));
  return {
    allocatedAmount,
    remainingAmount: round2(Math.max(0, Number(payment.amount || 0) - allocatedAmount)),
    allocations: rows,
  };
}

export async function documentAdvanceAllocated(partyType: AdvancePartyType, documentId: string) {
  const rows = await allocationRows(partyType);
  return round2(rows
    .filter((row: any) => String(row.milestone || "") === String(documentId || ""))
    .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
}

export async function synchronizeSettlement(partyType: AdvancePartyType, documentId: string) {
  const customer = partyType === "Customer";
  const table = customer ? "Invoices" : "SupplierBills";
  const idField = customer ? "invoiceId" : "billId";
  const document = (await findRecords<any>(table, { [idField]: documentId }, 1)).rows[0];
  if (!document) throw new Error(`${customer ? "Sales Invoice" : "Supplier Invoice"} not found`);

  const payments = await findRecords<any>("Payments", { againstDocumentId: documentId, status: "POSTED" }, 500);
  const direct = round2((payments.rows || [])
    .filter((row: any) => customer
      ? String(row.paymentType || "").toUpperCase() === "RECEIVE" && String(row.partyType || "") === "Customer"
      : String(row.paymentType || "").toUpperCase() === "PAY" && String(row.partyType || "") === "Supplier")
    .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));

  const advanceAllocated = await documentAdvanceAllocated(partyType, documentId);
  const total = Number(document.totalAmount || 0);
  const settled = round2(direct + advanceAllocated);
  if (settled > total + 0.001) throw new Error("Settlement exceeds document total; reconciliation review required");
  const outstandingAmount = round2(Math.max(0, total - settled));
  const status = outstandingAmount <= 0.001 ? "PAID" : settled > 0.001 ? "PARTLY_PAID" : "POSTED";
  await updateRecord(table, idField, documentId, {
    paidAmount: settled,
    outstandingAmount,
    status,
  }, "advance-allocation:settlement-sync");
  return { total, directPaid: direct, advanceAllocated, settled, outstandingAmount, status };
}

export async function allocateAdvancePartial(input: {
  paymentId: string;
  againstDocumentType: AdvanceDocumentType;
  againstDocumentId: string;
  amount?: number;
  allocationDate?: string;
}) {
  const payment = (await findRecords<any>("Payments", { paymentId: input.paymentId }, 1)).rows[0];
  if (!payment) throw new Error("Advance Payment Entry not found");
  if (String(payment.status || "").toUpperCase() !== "POSTED" || !String(payment.journalId || "").trim()) {
    throw new Error("Advance Payment Entry must be finalized before allocation");
  }
  const partyType = String(payment.partyType || "") as AdvancePartyType;
  if (!(["Customer", "Supplier"] as string[]).includes(partyType)) throw new Error("Unsupported advance party type");
  const customer = partyType === "Customer";
  if (customer && input.againstDocumentType !== "Sales Invoice") throw new Error("Customer advances can only be allocated to Sales Invoices");
  if (!customer && input.againstDocumentType !== "Supplier Invoice") throw new Error("Supplier advances can only be allocated to Supplier Invoices");

  const table = customer ? "Invoices" : "SupplierBills";
  const idField = customer ? "invoiceId" : "billId";
  const source = (await findRecords<any>(table, { [idField]: input.againstDocumentId }, 1)).rows[0];
  if (!source) throw new Error(`${input.againstDocumentType} not found`);
  const sourceStatus = String(source.status || "").toUpperCase();
  if (!["POSTED", "PARTLY_PAID", "PAID"].includes(sourceStatus)) {
    throw new Error(`${input.againstDocumentType} must be posted before advance allocation`);
  }
  if (customer && String(source.customerId || "") !== String(payment.partyId || "")) throw new Error("Advance customer does not match Sales Invoice customer");
  if (!customer && String(source.supplierId || "") !== String(payment.partyId || "")) throw new Error("Advance supplier does not match Supplier Invoice supplier");

  const summary = await advanceAllocationSummary(payment);
  if (summary.remainingAmount <= 0.001) throw new Error("This advance has no unallocated balance remaining");
  const outstanding = Number(source.outstandingAmount ?? source.totalAmount ?? 0);
  if (outstanding <= 0.001) throw new Error(`${input.againstDocumentType} has no outstanding balance`);
  const requested = Number(input.amount || 0);
  const amount = round2(requested > 0 ? requested : Math.min(summary.remainingAmount, outstanding));
  if (!(amount > 0)) throw new Error("Allocation amount must be greater than zero");
  if (amount > summary.remainingAmount + 0.001) throw new Error(`Allocation exceeds unallocated advance balance K${summary.remainingAmount.toFixed(2)}`);
  if (amount > outstanding + 0.001) throw new Error(`Allocation exceeds document outstanding balance K${outstanding.toFixed(2)}`);

  const allocationId = `ALLOC-${randomUUID().slice(0, 12).toUpperCase()}`;
  const allocationDate = String(input.allocationDate || localDate());
  const lines = customer
    ? [
        { accountId: "ACC-2150", debit: amount, customerId: payment.partyId, projectId: payment.projectId, description: "Apply customer advance" },
        { accountId: "ACC-1130", credit: amount, customerId: payment.partyId, projectId: payment.projectId, description: "Settle Accounts Receivable from advance" },
      ]
    : [
        { accountId: "ACC-2110", debit: amount, supplierId: payment.partyId, projectId: payment.projectId, description: "Settle Accounts Payable from advance" },
        { accountId: "ACC-1160", credit: amount, supplierId: payment.partyId, projectId: payment.projectId, description: "Apply supplier advance" },
      ];

  const journal = await postJournal({
    postingDate: allocationDate,
    documentType: customer ? "CUSTOMER_ADVANCE_ALLOCATION" : "SUPPLIER_ADVANCE_ALLOCATION",
    documentId: allocationId,
    documentNumber: String(payment.paymentNumber || payment.paymentId),
    reference: `Allocate ${payment.paymentNumber || payment.paymentId} to ${input.againstDocumentId}`,
    projectId: payment.projectId,
    lines,
  });

  await appendRecord("PaymentSchedules", {
    scheduleId: allocationId,
    sourceType: allocationSourceType(partyType),
    sourceId: payment.paymentId,
    projectId: payment.projectId || "",
    partyId: payment.partyId || "",
    milestone: input.againstDocumentId,
    dueDate: allocationDate,
    percentage: 0,
    amount,
    status: "POSTED",
  }, "advance-allocation");

  const settlement = await synchronizeSettlement(partyType, input.againstDocumentId);
  const refreshed = await advanceAllocationSummary(payment);
  return {
    paymentId: payment.paymentId,
    againstDocumentId: input.againstDocumentId,
    journalId: journal.journalId,
    allocationId,
    allocatedAmount: amount,
    remainingAdvance: refreshed.remainingAmount,
    documentOutstanding: settlement.outstandingAmount,
    documentStatus: settlement.status,
  };
}
