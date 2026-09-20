import type { AtomicPostingLine } from "@/lib/accounting/atomic-posting";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { allocateAdvancePaymentAtomic, createPaymentAllocationInTransaction } from "@/lib/accounting/payment-allocation";

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
  if (input.againstInvoiceId && input.againstBillId) {
    throw new Error("A Payment Entry cannot target both a Sales Invoice and Supplier Invoice");
  }

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

    const directAllocation = input.againstInvoiceId || input.againstBillId
      ? await createPaymentAllocationInTransaction(tx, {
          paymentId: payment.id,
          againstDocumentType: input.againstInvoiceId ? "Sales Invoice" : "Supplier Invoice",
          againstDocumentId: String(input.againstInvoiceId || input.againstBillId),
          amount,
          allocationDate: input.postingDate,
          allocationType: "DIRECT",
          idempotencyKey: `DIRECT:${payment.id}`,
          createdBy: input.createdBy || "payment-final-save",
        })
      : null;

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

    if (directAllocation && !directAllocation.alreadyAllocated) {
      await tx.paymentAllocation.update({
        where: { id: directAllocation.allocation.id },
        data: { journalId: journal.journalId },
      });
    }

    // invoiceId/billId are retained in the schema only as legacy draft intent.
    // Once posted, PaymentAllocation is the sole settlement authority.
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        journalId: journal.journalId,
        invoiceId: null,
        billId: null,
      },
    });

    return {
      paymentId: payment.id,
      journalId: journal.journalId,
      status: "POSTED" as const,
      alreadyFinalized: false,
      allocationId: directAllocation?.allocation.id,
      invoiceOutstanding: input.againstInvoiceId
        ? directAllocation?.documentOutstanding
        : undefined,
      billOutstanding: input.againstBillId
        ? directAllocation?.documentOutstanding
        : undefined,
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
  const amount = round2(
    input.lines.reduce(
      (max, line) => Math.max(max, Number(line.debit || 0), Number(line.credit || 0)),
      0,
    ),
  );
  if (!(amount > 0)) throw new Error("Advance allocation amount must be greater than zero");

  return allocateAdvancePaymentAtomic({
    paymentId: input.paymentId,
    againstDocumentType: input.againstDocumentType,
    againstDocumentId: input.againstDocumentId,
    amount,
    allocationDate: input.postingDate,
    idempotencyKey: `LEGACY-FULL:${input.paymentId}:${input.againstDocumentType}:${input.againstDocumentId}`,
    createdBy: input.createdBy,
    approvedBy: input.approvedBy,
  });
}

