import type { Prisma } from "@prisma/client";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { prisma } from "@/src/lib/prisma";
import { assertSettlementCurrency, realizedFxForSettlement, resolveDocumentExchangeRate, roundCurrency } from "@/lib/accounting/currency";

export type AllocationDocumentType = "Sales Invoice" | "Supplier Invoice";
export type CanonicalAllocationType = "DIRECT" | "ADVANCE" | "MIGRATED";

export type AllocationRequest = {
  paymentId: string;
  againstDocumentType: AllocationDocumentType;
  againstDocumentId: string;
  amount: number;
  allocationDate: string;
  allocationType: CanonicalAllocationType;
  idempotencyKey?: string;
  createdBy?: string;
  journalId?: string | null;
};

type AllocationTx = Prisma.TransactionClient;

const round2 = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function allocationDate(value: string) {
  const normalized = normalizeAccountingDate(value);
  return {
    normalized,
    date: new Date(`${normalized}T00:00:00+10:00`),
  };
}

async function postedAllocationTotalForPayment(tx: AllocationTx, paymentId: string) {
  const result = await tx.paymentAllocation.aggregate({
    where: { paymentId, status: "POSTED" },
    _sum: { amount: true },
  });
  return round2(Number(result._sum.amount || 0));
}

async function resolveTarget(
  tx: AllocationTx,
  input: Pick<AllocationRequest, "againstDocumentType" | "againstDocumentId">,
) {
  if (input.againstDocumentType === "Sales Invoice") {
    const invoice = await tx.invoice.findFirst({
      where: {
        OR: [
          { id: input.againstDocumentId },
          { code: input.againstDocumentId },
        ],
      },
    });
    if (!invoice) throw new Error("Sales Invoice not found");
    return { invoice, bill: null };
  }

  const bill = await tx.supplierBill.findFirst({
    where: {
      OR: [
        { id: input.againstDocumentId },
        { code: input.againstDocumentId },
      ],
    },
  });
  if (!bill) throw new Error("Supplier Invoice not found");
  return { invoice: null, bill };
}

export async function createPaymentAllocationInTransaction(
  tx: AllocationTx,
  input: AllocationRequest,
) {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error("Allocation amount must be greater than zero");

  const { normalized, date } = allocationDate(input.allocationDate);
  const payment = await tx.payment.findFirst({
    where: {
      OR: [
        { id: input.paymentId },
        { code: input.paymentId },
      ],
    },
  });
  if (!payment) throw new Error("Payment Entry not found");

  if (input.idempotencyKey) {
    const existing = await tx.paymentAllocation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        allocation: existing,
        alreadyAllocated: true,
      };
    }
  }

  const allocatedBefore = await postedAllocationTotalForPayment(tx, payment.id);
  const remainingPayment = round2(Number(payment.amount || 0) - allocatedBefore);
  if (amount > remainingPayment + 0.001) {
    throw new Error(
      `Allocation exceeds unallocated Payment Entry balance K${remainingPayment.toFixed(2)}`,
    );
  }

  const { invoice, bill } = await resolveTarget(tx, input);

  const document = invoice || bill!;
  assertSettlementCurrency(payment.currency, document.currency);
  const paymentFx = await resolveDocumentExchangeRate(tx, {
    currency: payment.currency,
    exchangeRate: Number(payment.exchangeRate || 0) || undefined,
    postingDate: normalized,
  });
  const documentFx = await resolveDocumentExchangeRate(tx, {
    currency: document.currency,
    exchangeRate: Number(document.exchangeRate || 0) || undefined,
    postingDate: invoice ? invoice.issuedDate : bill!.billDate,
  });
  const settlementFx = realizedFxForSettlement({
    direction: invoice ? "RECEIVABLE" : "PAYABLE",
    transactionAmount: amount,
    documentExchangeRate: documentFx.exchangeRate,
    settlementExchangeRate: paymentFx.exchangeRate,
  });

  if (invoice) {
    if (!payment.customerId || payment.customerId !== invoice.customerId) {
      throw new Error("Payment customer does not match Sales Invoice customer");
    }
    if (!["SENT", "PARTIAL", "PAID"].includes(invoice.status)) {
      throw new Error("Allocation requires a posted Sales Invoice");
    }
    const outstanding = round2(Number(invoice.outstanding || 0));
    if (amount > outstanding + 0.001) {
      throw new Error(
        `Allocation exceeds Sales Invoice outstanding amount K${outstanding.toFixed(2)}`,
      );
    }
  }

  if (bill) {
    if (!payment.supplierId || payment.supplierId !== bill.supplierId) {
      throw new Error("Payment supplier does not match Supplier Invoice supplier");
    }
    if (!["SENT", "PARTIAL", "PAID"].includes(bill.status)) {
      throw new Error("Allocation requires a posted Supplier Invoice");
    }
    const outstanding = round2(Number(bill.outstanding || 0));
    if (amount > outstanding + 0.001) {
      throw new Error(
        `Allocation exceeds Supplier Invoice outstanding amount K${outstanding.toFixed(2)}`,
      );
    }
  }

  const allocation = await tx.paymentAllocation.create({
    data: {
      code: documentSeriesId("Payment Allocation"),
      paymentId: payment.id,
      invoiceId: invoice?.id || null,
      billId: bill?.id || null,
      allocationDate: date,
      amount,
      baseAmount: settlementFx.documentBase,
      currency: documentFx.currency,
      exchangeRate: paymentFx.exchangeRate,
      realizedFx: settlementFx.signed,
      allocationType: input.allocationType,
      status: "POSTED",
      journalId: input.journalId || null,
      idempotencyKey: input.idempotencyKey || null,
      createdBy: input.createdBy || "payment-allocation",
    },
  });

  if (invoice) {
    const paid = round2(Number(invoice.amountPaid || 0) + amount);
    const outstanding = round2(Math.max(0, Number(invoice.total || 0) - paid));
    const basePaid = roundCurrency(Number(invoice.baseAmountPaid || 0) + settlementFx.documentBase);
    const baseTotal = Number(invoice.baseTotal || 0) > 0
      ? Number(invoice.baseTotal)
      : roundCurrency(Number(invoice.total || 0) * documentFx.exchangeRate);
    const baseOutstanding = roundCurrency(Math.max(0, baseTotal - basePaid));
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid,
        outstanding,
        baseAmountPaid: basePaid,
        baseOutstanding,
        status: outstanding <= 0.001 ? "PAID" : "PARTIAL",
      },
    });
  }

  if (bill) {
    const paid = round2(Number(bill.amountPaid || 0) + amount);
    const outstanding = round2(Math.max(0, Number(bill.total || 0) - paid));
    const basePaid = roundCurrency(Number(bill.baseAmountPaid || 0) + settlementFx.documentBase);
    const baseTotal = Number(bill.baseTotal || 0) > 0
      ? Number(bill.baseTotal)
      : roundCurrency(Number(bill.total || 0) * documentFx.exchangeRate);
    const baseOutstanding = roundCurrency(Math.max(0, baseTotal - basePaid));
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: {
        amountPaid: paid,
        outstanding,
        baseAmountPaid: basePaid,
        baseOutstanding,
        status: outstanding <= 0.001 ? "PAID" : "PARTIAL",
      },
    });
  }

  return {
    allocation,
    alreadyAllocated: false,
    allocationDate: normalized,
    remainingPayment: round2(remainingPayment - amount),
    documentOutstanding: invoice
      ? round2(Math.max(0, Number(invoice.outstanding || 0) - amount))
      : round2(Math.max(0, Number(bill!.outstanding || 0) - amount)),
    currency: documentFx.currency,
    baseCurrency: documentFx.baseCurrency,
    documentExchangeRate: documentFx.exchangeRate,
    settlementExchangeRate: paymentFx.exchangeRate,
    documentBaseAmount: settlementFx.documentBase,
    settlementBaseAmount: settlementFx.settlementBase,
    realizedFx: settlementFx.signed,
    realizedGain: settlementFx.gain,
    realizedLoss: settlementFx.loss,
  };
}

export async function paymentAllocationSummary(
  paymentRef: string,
  client = prisma,
) {
  const payment = await client.payment.findFirst({
    where: {
      OR: [
        { id: paymentRef },
        { code: paymentRef },
      ],
    },
    include: {
      allocations: {
        where: { status: "POSTED" },
        orderBy: [{ allocationDate: "asc" }, { createdAt: "asc" }],
        include: {
          invoice: { select: { id: true, code: true } },
          bill: { select: { id: true, code: true } },
        },
      },
    },
  });
  if (!payment) throw new Error("Payment Entry not found");

  const allocatedAmount = round2(
    payment.allocations.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0,
    ),
  );

  return {
    paymentId: payment.id,
    paymentNumber: payment.code,
    paymentAmount: round2(Number(payment.amount || 0)),
    paymentBaseAmount: Number(payment.baseAmount || 0),
    currency: payment.currency,
    exchangeRate: Number(payment.exchangeRate || 1),
    allocatedAmount,
    remainingAmount: round2(Math.max(0, Number(payment.amount || 0) - allocatedAmount)),
    allocations: payment.allocations.map((row) => ({
      allocationId: row.id,
      allocationCode: row.code,
      allocationDate: row.allocationDate.toISOString().slice(0, 10),
      allocationType: row.allocationType,
      amount: Number(row.amount || 0),
      baseAmount: Number(row.baseAmount || 0),
      currency: row.currency,
      exchangeRate: Number(row.exchangeRate || 1),
      realizedFx: Number(row.realizedFx || 0),
      journalId: row.journalId || "",
      againstDocumentType: row.invoiceId ? "Sales Invoice" : "Supplier Invoice",
      againstDocumentId: row.invoiceId || row.billId || "",
      againstDocumentNumber: row.invoice?.code || row.bill?.code || "",
      status: row.status,
    })),
  };
}

export async function documentPaymentAllocationTotal(
  documentType: AllocationDocumentType,
  documentRef: string,
  client = prisma,
) {
  if (documentType === "Sales Invoice") {
    const invoice = await client.invoice.findFirst({
      where: { OR: [{ id: documentRef }, { code: documentRef }] },
      select: { id: true },
    });
    if (!invoice) throw new Error("Sales Invoice not found");
    const result = await client.paymentAllocation.aggregate({
      where: { invoiceId: invoice.id, status: "POSTED" },
      _sum: { amount: true },
    });
    return round2(Number(result._sum.amount || 0));
  }

  const bill = await client.supplierBill.findFirst({
    where: { OR: [{ id: documentRef }, { code: documentRef }] },
    select: { id: true },
  });
  if (!bill) throw new Error("Supplier Invoice not found");
  const result = await client.paymentAllocation.aggregate({
    where: { billId: bill.id, status: "POSTED" },
    _sum: { amount: true },
  });
  return round2(Number(result._sum.amount || 0));
}

export async function allocateAdvancePaymentAtomic(input: {
  paymentId: string;
  againstDocumentType: AllocationDocumentType;
  againstDocumentId: string;
  amount: number;
  allocationDate: string;
  idempotencyKey?: string;
  createdBy?: string;
  approvedBy?: string;
}) {
  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const payment = await tx.payment.findFirst({
      where: {
        OR: [
          { id: input.paymentId },
          { code: input.paymentId },
        ],
      },
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
    if (customer && input.againstDocumentType !== "Sales Invoice") {
      throw new Error("Customer advances can only be allocated to Sales Invoices");
    }
    if (!customer && input.againstDocumentType !== "Supplier Invoice") {
      throw new Error("Supplier advances can only be allocated to Supplier Invoices");
    }

    if (input.idempotencyKey) {
      const prior = await tx.paymentAllocation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        return {
          paymentId: payment.id,
          allocationId: prior.id,
          allocationCode: prior.code,
          journalId: prior.journalId || "",
          allocatedAmount: Number(prior.amount || 0),
          remainingAdvance: round2(
            Number(payment.amount || 0) - await postedAllocationTotalForPayment(tx, payment.id),
          ),
          documentOutstanding: null,
          alreadyAllocated: true,
        };
      }
    }

    const partyRef = customer
      ? (payment.customer?.code || payment.customerId || "")
      : (payment.supplier?.code || payment.supplierId || "");
    const projectRef = payment.project?.code || payment.projectId || "";
    const amount = round2(input.amount);

    const allocation = await createPaymentAllocationInTransaction(tx, {
      paymentId: payment.id,
      againstDocumentType: input.againstDocumentType,
      againstDocumentId: input.againstDocumentId,
      amount,
      allocationDate: input.allocationDate,
      allocationType: "ADVANCE",
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy || "advance-allocation",
    });

    if (allocation.alreadyAllocated) {
      return {
        paymentId: payment.id,
        allocationId: allocation.allocation.id,
        allocationCode: allocation.allocation.code,
        journalId: allocation.allocation.journalId || "",
        allocatedAmount: Number(allocation.allocation.amount || 0),
        remainingAdvance: allocation.remainingPayment ?? 0,
        documentOutstanding: allocation.documentOutstanding ?? null,
        alreadyAllocated: true,
      };
    }

    const settlementBaseAmount = Number(settlementBaseAmount || 0);
    const documentBaseAmount = Number(documentBaseAmount || 0);
    const settlementExchangeRate = Number(settlementExchangeRate || 1);
    const documentExchangeRate = Number(documentExchangeRate || 1);
    const realizedGain = Number(realizedGain || 0);
    const realizedLoss = Number(realizedLoss || 0);

    const transactionAudit = (side: "debit" | "credit", rate: number) => ({
      transactionCurrency: allocation.currency,
      exchangeRate: rate,
      transactionDebit: side === "debit" ? amount : 0,
      transactionCredit: side === "credit" ? amount : 0,
    });
    const zeroFxAudit = {
      transactionCurrency: allocation.baseCurrency,
      exchangeRate: 1,
      transactionDebit: 0,
      transactionCredit: 0,
    };

    const journalLines = customer
      ? [
          {
            accountId: INITIAL_ACCOUNT_IDS.customerAdvances,
            debit: settlementBaseAmount,
            ...transactionAudit("debit", settlementExchangeRate),
            customerId: partyRef,
            projectId: projectRef,
            description: "Apply customer advance",
          },
          {
            accountId: INITIAL_ACCOUNT_IDS.accountsReceivable,
            credit: documentBaseAmount,
            ...transactionAudit("credit", documentExchangeRate),
            customerId: partyRef,
            projectId: projectRef,
            description: "Settle Accounts Receivable from advance",
          },
        ]
      : [
          {
            accountId: INITIAL_ACCOUNT_IDS.accountsPayable,
            debit: documentBaseAmount,
            ...transactionAudit("debit", documentExchangeRate),
            supplierId: partyRef,
            projectId: projectRef,
            description: "Settle Accounts Payable from advance",
          },
          {
            accountId: INITIAL_ACCOUNT_IDS.supplierAdvances,
            credit: settlementBaseAmount,
            ...transactionAudit("credit", settlementExchangeRate),
            supplierId: partyRef,
            projectId: projectRef,
            description: "Apply supplier advance",
          },
        ];

    if (realizedGain > 0) {
      journalLines.push({
        accountId: INITIAL_ACCOUNT_IDS.exchangeGain,
        credit: realizedGain,
        ...zeroFxAudit,
        projectId: projectRef,
        description: "Realized foreign exchange gain on advance allocation",
      } as any);
    }
    if (realizedLoss > 0) {
      journalLines.push({
        accountId: INITIAL_ACCOUNT_IDS.exchangeLoss,
        debit: realizedLoss,
        ...zeroFxAudit,
        projectId: projectRef,
        description: "Realized foreign exchange loss on advance allocation",
      } as any);
    }

    const journal = await postJournal({
      postingDate: input.allocationDate,
      documentType: customer
        ? "CUSTOMER_ADVANCE_ALLOCATION"
        : "SUPPLIER_ADVANCE_ALLOCATION",
      documentId: allocation.allocation.id,
      documentNumber: allocation.allocation.code,
      reference: `Allocate ${payment.code} to ${input.againstDocumentId}`,
      projectId: projectRef,
      currency: allocation.currency,
      baseCurrency: allocation.baseCurrency,
      exchangeRate: settlementExchangeRate,
      createdBy: input.createdBy || "advance-allocation",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: journalLines,
    });

    await tx.paymentAllocation.update({
      where: { id: allocation.allocation.id },
      data: { journalId: journal.journalId },
    });

    return {
      paymentId: payment.id,
      allocationId: allocation.allocation.id,
      allocationCode: allocation.allocation.code,
      journalId: journal.journalId,
      allocatedAmount: amount,
      remainingAdvance: allocation.remainingPayment,
      documentOutstanding: allocation.documentOutstanding,
      currency: allocation.currency,
      baseCurrency: allocation.baseCurrency,
      realizedFx: allocation.realizedFx,
      realizedGain: realizedGain,
      realizedLoss: realizedLoss,
      alreadyAllocated: false,
    };
  });
}
