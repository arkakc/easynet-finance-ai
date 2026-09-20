import type { AtomicPostingLine } from "@/lib/accounting/atomic-posting";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export type AtomicPaymentFinalizationInput = {
  paymentId: string;
  postingDate: string;
  amount: number;
  paymentMethod: string;
  cashBankAccountId: string;
  reference?: string;
  documentType: string;
  documentNumber: string;
  projectId?: string;
  lines: AtomicPostingLine[];
  againstInvoiceId?: string;
  againstBillId?: string;
  createdBy?: string;
  approvedBy?: string;
};

export async function finalizePaymentAtomic(input: AtomicPaymentFinalizationInput) {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");

  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const payment = await tx.payment.findFirst({
      where: { OR: [{ id: input.paymentId }, { code: input.paymentId }] },
    });
    if (!payment) throw new Error("Payment Entry not found");

    if (payment.journalId && payment.status === "CLEARED") {
      return {
        paymentId: payment.id,
        journalId: payment.journalId,
        status: "POSTED" as const,
        alreadyFinalized: true,
      };
    }
    if (payment.status !== "AUTHORIZED") {
      throw new Error(`Payment Entry must be APPROVED before Final Save. Current status: ${payment.status}`);
    }

    let invoiceUpdate: { id: string; amountPaid: number; outstanding: number; status: "PARTIAL" | "PAID" } | null = null;
    let billUpdate: { id: string; amountPaid: number; outstanding: number; status: "PARTIAL" | "PAID" } | null = null;

    if (input.againstInvoiceId) {
      const invoice = await tx.invoice.findFirst({
        where: { OR: [{ id: input.againstInvoiceId }, { code: input.againstInvoiceId }] },
      });
      if (!invoice) throw new Error("Against Sales Invoice not found");
      if (!payment.customerId || payment.customerId !== invoice.customerId) {
        throw new Error("Payment customer does not match the Sales Invoice customer");
      }
      if (!["SENT", "PARTIAL", "PAID"].includes(invoice.status)) {
        throw new Error("Customer receipt can only be allocated against a posted Sales Invoice");
      }
      const outstandingBefore = round2(Number(invoice.outstanding));
      if (amount > outstandingBefore + 0.001) {
        throw new Error("Customer receipt exceeds Sales Invoice outstanding amount");
      }
      const paid = round2(Number(invoice.amountPaid) + amount);
      const outstanding = round2(Math.max(0, Number(invoice.total) - paid));
      invoiceUpdate = {
        id: invoice.id,
        amountPaid: paid,
        outstanding,
        status: outstanding <= 0.001 ? "PAID" : "PARTIAL",
      };
    }

    if (input.againstBillId) {
      const bill = await tx.supplierBill.findFirst({
        where: { OR: [{ id: input.againstBillId }, { code: input.againstBillId }] },
      });
      if (!bill) throw new Error("Against Supplier Invoice not found");
      if (!payment.supplierId || payment.supplierId !== bill.supplierId) {
        throw new Error("Payment supplier does not match the Supplier Invoice supplier");
      }
      if (!["SENT", "PARTIAL", "PAID"].includes(bill.status)) {
        throw new Error("Supplier payment can only be allocated against a posted Supplier Invoice");
      }
      const outstandingBefore = round2(Number(bill.outstanding));
      if (amount > outstandingBefore + 0.001) {
        throw new Error("Supplier payment exceeds Supplier Invoice outstanding amount");
      }
      const paid = round2(Number(bill.amountPaid) + amount);
      const outstanding = round2(Math.max(0, Number(bill.total) - paid));
      billUpdate = {
        id: bill.id,
        amountPaid: paid,
        outstanding,
        status: outstanding <= 0.001 ? "PAID" : "PARTIAL",
      };
    }

    // Write the operational/subledger state first. If journal validation or
    // persistence fails later, Prisma rolls every one of these mutations back.
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        date: new Date(`${String(input.postingDate).slice(0, 10)}T00:00:00+10:00`),
        amount,
        paymentMethod: input.paymentMethod,
        depositAccount: input.cashBankAccountId,
        referenceNumber: input.reference || null,
        status: "CLEARED",
      },
    });

    if (invoiceUpdate) {
      await tx.invoice.update({
        where: { id: invoiceUpdate.id },
        data: {
          amountPaid: invoiceUpdate.amountPaid,
          outstanding: invoiceUpdate.outstanding,
          status: invoiceUpdate.status,
        },
      });
    }

    if (billUpdate) {
      await tx.supplierBill.update({
        where: { id: billUpdate.id },
        data: {
          amountPaid: billUpdate.amountPaid,
          outstanding: billUpdate.outstanding,
          status: billUpdate.status,
        },
      });
    }

    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: input.documentType,
      documentId: payment.id,
      documentNumber: input.documentNumber,
      reference: input.reference || input.documentNumber,
      projectId: input.projectId,
      createdBy: input.createdBy || "payment-final-save",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: input.lines,
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { journalId: journal.journalId },
    });

    return {
      paymentId: payment.id,
      journalId: journal.journalId,
      status: "POSTED" as const,
      alreadyFinalized: false,
      invoiceOutstanding: invoiceUpdate?.outstanding,
      billOutstanding: billUpdate?.outstanding,
    };
  });
}


export type AtomicAdvanceAllocationInput = {
  paymentId: string;
  againstDocumentType: "Sales Invoice" | "Supplier Invoice";
  againstDocumentId: string;
  postingDate: string;
  documentNumber: string;
  projectId?: string;
  lines: AtomicPostingLine[];
  createdBy?: string;
  approvedBy?: string;
};

export async function allocateAdvanceAtomic(input: AtomicAdvanceAllocationInput) {
  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const payment = await tx.payment.findFirst({
      where: { OR: [{ id: input.paymentId }, { code: input.paymentId }] },
    });
    if (!payment) throw new Error("Advance Payment Entry not found");
    if (payment.status !== "CLEARED" || !payment.journalId) {
      throw new Error("Advance Payment Entry must be finalized before allocation");
    }

    const customerAdvance = Boolean(payment.customerId);
    if (customerAdvance && input.againstDocumentType !== "Sales Invoice") {
      throw new Error("Customer advances can only be allocated to Sales Invoices");
    }
    if (!customerAdvance && input.againstDocumentType !== "Supplier Invoice") {
      throw new Error("Supplier advances can only be allocated to Supplier Invoices");
    }

    const amount = round2(Number(payment.amount || 0));
    if (!(amount > 0)) throw new Error("Advance amount must be greater than zero");

    const documentType = customerAdvance
      ? "CUSTOMER_ADVANCE_ALLOCATION"
      : "SUPPLIER_ADVANCE_ALLOCATION";

    const invoice = customerAdvance
      ? await tx.invoice.findFirst({
          where: { OR: [{ id: input.againstDocumentId }, { code: input.againstDocumentId }] },
        })
      : null;
    const bill = !customerAdvance
      ? await tx.supplierBill.findFirst({
          where: { OR: [{ id: input.againstDocumentId }, { code: input.againstDocumentId }] },
        })
      : null;

    if (customerAdvance && !invoice) throw new Error("Sales Invoice not found");
    if (!customerAdvance && !bill) throw new Error("Supplier Invoice not found");
    if (invoice && payment.customerId !== invoice.customerId) {
      throw new Error("Advance customer does not match Sales Invoice customer");
    }
    if (bill && payment.supplierId !== bill.supplierId) {
      throw new Error("Advance supplier does not match Supplier Invoice supplier");
    }

    const targetId = invoice?.id || bill!.id;
    const allocationSourceId = `${payment.id}-${targetId}`;
    const existingAllocationJournal = await tx.journalHeader.findFirst({
      where: {
        sourceDocType: documentType,
        sourceDocId: allocationSourceId,
      },
      select: { code: true },
    });

    const alreadyLinked = customerAdvance
      ? payment.invoiceId === targetId
      : payment.billId === targetId;
    if (alreadyLinked && existingAllocationJournal) {
      return {
        paymentId: payment.id,
        againstDocumentId: targetId,
        journalId: existingAllocationJournal.code,
        allocatedAmount: amount,
        alreadyAllocated: true,
      };
    }
    if (payment.invoiceId || payment.billId) {
      throw new Error("This advance is already allocated to another document");
    }
    if (existingAllocationJournal) {
      throw new Error("Advance allocation journal exists without payment linkage; manual review required");
    }

    if (invoice) {
      if (!["SENT", "PARTIAL", "PAID"].includes(invoice.status)) {
        throw new Error("Customer advance can only be allocated against a posted Sales Invoice");
      }
      const outstanding = round2(Number(invoice.outstanding || 0));
      if (amount > outstanding + 0.001) {
        throw new Error("Full advance allocation exceeds Sales Invoice outstanding amount");
      }

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
      await tx.payment.update({
        where: { id: payment.id },
        data: { invoiceId: invoice.id },
      });
    }

    if (bill) {
      if (!["SENT", "PARTIAL", "PAID"].includes(bill.status)) {
        throw new Error("Supplier advance can only be allocated against a posted Supplier Invoice");
      }
      const outstanding = round2(Number(bill.outstanding || 0));
      if (amount > outstanding + 0.001) {
        throw new Error("Full advance allocation exceeds Supplier Invoice outstanding amount");
      }

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
      await tx.payment.update({
        where: { id: payment.id },
        data: { billId: bill.id },
      });
    }

    // Association + AR/AP settlement are written first on purpose. Any
    // journal validation failure must roll those changes back atomically.
    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType,
      documentId: allocationSourceId,
      documentNumber: input.documentNumber,
      reference: `Allocate ${input.documentNumber} to ${input.againstDocumentId}`,
      projectId: input.projectId,
      createdBy: input.createdBy || "advance-allocation",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: input.lines,
    });

    return {
      paymentId: payment.id,
      againstDocumentId: targetId,
      journalId: journal.journalId,
      allocatedAmount: amount,
      alreadyAllocated: false,
    };
  });
}
