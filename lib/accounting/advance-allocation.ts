import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { findPaymentSchedules, insertPaymentSchedule } from "@/lib/accounting/payment-schedule-store";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { round2 } from "@/lib/accounting/inventory";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

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
  const allocationId = documentSeriesId("Allocation");
  const allocationDate = String(input.allocationDate || localDate());

  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const payment = await tx.payment.findFirst({
      where: { OR: [{ id: input.paymentId }, { code: input.paymentId }] },
      include: {
        customer: { select: { code: true } },
        supplier: { select: { code: true } },
        project: { select: { code: true } },
      },
    });
    if (!payment) throw new Error("Advance Payment Entry not found");
    if (payment.status !== "CLEARED" || !payment.journalId) {
      throw new Error("Advance Payment Entry must be finalized before allocation");
    }

    const customer = Boolean(payment.customerId);
    const partyType: AdvancePartyType = customer ? "Customer" : "Supplier";
    if (customer && input.againstDocumentType !== "Sales Invoice") {
      throw new Error("Customer advances can only be allocated to Sales Invoices");
    }
    if (!customer && input.againstDocumentType !== "Supplier Invoice") {
      throw new Error("Supplier advances can only be allocated to Supplier Invoices");
    }

    const sourceType = allocationSourceType(partyType);
    const schedules = await findPaymentSchedules(sourceType, payment.id, tx);
    const scheduledAllocated = round2(
      schedules
        .filter((row) => String(row.status || "").toUpperCase() === POSTED_ALLOCATION)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    );

    // A direct payment->document link belongs to the older full-allocation
    // model. Do not permit partial-ledger allocations on top of that state.
    const legacyAllocated = (payment.invoiceId || payment.billId) && scheduledAllocated <= 0.001
      ? Number(payment.amount || 0)
      : 0;
    const allocatedAmount = round2(Math.max(scheduledAllocated, legacyAllocated));
    const remainingAmount = round2(Math.max(0, Number(payment.amount || 0) - allocatedAmount));
    if (remainingAmount <= 0.001) throw new Error("This advance has no unallocated balance remaining");

    const invoice = customer
      ? await tx.invoice.findFirst({
          where: { OR: [{ id: input.againstDocumentId }, { code: input.againstDocumentId }] },
        })
      : null;
    const bill = !customer
      ? await tx.supplierBill.findFirst({
          where: { OR: [{ id: input.againstDocumentId }, { code: input.againstDocumentId }] },
        })
      : null;

    if (customer && !invoice) throw new Error("Sales Invoice not found");
    if (!customer && !bill) throw new Error("Supplier Invoice not found");
    if (invoice && payment.customerId !== invoice.customerId) {
      throw new Error("Advance customer does not match Sales Invoice customer");
    }
    if (bill && payment.supplierId !== bill.supplierId) {
      throw new Error("Advance supplier does not match Supplier Invoice supplier");
    }
    if (invoice && !["SENT", "PARTIAL", "PAID"].includes(invoice.status)) {
      throw new Error("Sales Invoice must be posted before advance allocation");
    }
    if (bill && !["SENT", "PARTIAL", "PAID"].includes(bill.status)) {
      throw new Error("Supplier Invoice must be posted before advance allocation");
    }

    const outstanding = round2(Number(invoice?.outstanding ?? bill?.outstanding ?? 0));
    if (outstanding <= 0.001) {
      throw new Error(`${input.againstDocumentType} has no outstanding balance`);
    }
    const requested = Number(input.amount || 0);
    const amount = round2(requested > 0 ? requested : Math.min(remainingAmount, outstanding));
    if (!(amount > 0)) throw new Error("Allocation amount must be greater than zero");
    if (amount > remainingAmount + 0.001) {
      throw new Error(`Allocation exceeds unallocated advance balance K${remainingAmount.toFixed(2)}`);
    }
    if (amount > outstanding + 0.001) {
      throw new Error(`Allocation exceeds document outstanding balance K${outstanding.toFixed(2)}`);
    }

    const partyRef = customer
      ? (payment.customer?.code || payment.customerId || "")
      : (payment.supplier?.code || payment.supplierId || "");
    const projectRef = payment.project?.code || payment.projectId || "";
    const lines = customer
      ? [
          {
            accountId: INITIAL_ACCOUNT_IDS.customerAdvances,
            debit: amount,
            customerId: partyRef,
            projectId: projectRef,
            description: "Apply customer advance",
          },
          {
            accountId: INITIAL_ACCOUNT_IDS.accountsReceivable,
            credit: amount,
            customerId: partyRef,
            projectId: projectRef,
            description: "Settle Accounts Receivable from advance",
          },
        ]
      : [
          {
            accountId: INITIAL_ACCOUNT_IDS.accountsPayable,
            debit: amount,
            supplierId: partyRef,
            projectId: projectRef,
            description: "Settle Accounts Payable from advance",
          },
          {
            accountId: INITIAL_ACCOUNT_IDS.supplierAdvances,
            credit: amount,
            supplierId: partyRef,
            projectId: projectRef,
            description: "Apply supplier advance",
          },
        ];

    if (invoice) {
      const paid = round2(Number(invoice.amountPaid || 0) + amount);
      const after = round2(Math.max(0, Number(invoice.total || 0) - paid));
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: paid,
          outstanding: after,
          status: after <= 0.001 ? "PAID" : "PARTIAL",
        },
      });
    }
    if (bill) {
      const paid = round2(Number(bill.amountPaid || 0) + amount);
      const after = round2(Math.max(0, Number(bill.total || 0) - paid));
      await tx.supplierBill.update({
        where: { id: bill.id },
        data: {
          amountPaid: paid,
          outstanding: after,
          status: after <= 0.001 ? "PAID" : "PARTIAL",
        },
      });
    }

    await insertPaymentSchedule({
      scheduleId: allocationId,
      sourceType,
      sourceId: payment.id,
      projectId: projectRef,
      partyId: partyRef,
      milestone: invoice?.id || bill!.id,
      dueDate: allocationDate,
      percentage: 0,
      amount,
      status: POSTED_ALLOCATION,
    }, "advance-allocation", tx);

    const journal = await postJournal({
      postingDate: allocationDate,
      documentType: sourceType,
      documentId: allocationId,
      documentNumber: payment.code,
      reference: `Allocate ${payment.code} to ${input.againstDocumentId}`,
      projectId: projectRef,
      createdBy: "advance-allocation",
      approvedBy: "Finance Controller",
      lines,
    });

    const refreshedRows = await findPaymentSchedules(sourceType, payment.id, tx);
    const nowAllocated = round2(
      refreshedRows
        .filter((row) => String(row.status || "").toUpperCase() === POSTED_ALLOCATION)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    );
    const documentOutstanding = round2(Number(
      invoice
        ? (await tx.invoice.findUnique({ where: { id: invoice.id }, select: { outstanding: true } }))?.outstanding || 0
        : (await tx.supplierBill.findUnique({ where: { id: bill!.id }, select: { outstanding: true } }))?.outstanding || 0,
    ));

    return {
      paymentId: payment.id,
      againstDocumentId: invoice?.id || bill!.id,
      journalId: journal.journalId,
      allocationId,
      allocatedAmount: amount,
      remainingAdvance: round2(Math.max(0, Number(payment.amount || 0) - nowAllocated)),
      documentOutstanding,
      documentStatus: documentOutstanding <= 0.001 ? "PAID" : "PARTLY_PAID",
    };
  });
}

