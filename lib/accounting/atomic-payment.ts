import type { AtomicPostingLine } from "@/lib/accounting/atomic-posting";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { allocateAdvancePaymentAtomic, createPaymentAllocationInTransaction } from "@/lib/accounting/payment-allocation";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { realizedFxForSettlement, resolveDocumentExchangeRate, toBaseAmount } from "@/lib/accounting/currency";

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
  exchangeGainAccountId?: string;
  exchangeLossAccountId?: string;
  customerRefundCreditExchangeRate?: number;
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
      include: {
        customer: { select: { code: true } },
        supplier: { select: { code: true } },
        project: { select: { code: true } },
      },
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

    const fx = await resolveDocumentExchangeRate(tx, {
      currency: payment.currency,
      exchangeRate: Number(payment.exchangeRate || 0) || undefined,
      postingDate: input.postingDate,
    });
    const baseAmount = toBaseAmount(amount, fx.currency, fx.baseCurrency, fx.exchangeRate);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        date: new Date(`${String(input.postingDate).slice(0, 10)}T00:00:00+10:00`),
        amount,
        baseAmount,
        currency: fx.currency,
        exchangeRate: fx.exchangeRate,
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

    let postingLines: AtomicPostingLine[];
    let realizedFx = directAllocation?.realizedFx || 0;

    if (input.documentType === "CUSTOMER_REFUND") {
      const creditRate = Number(input.customerRefundCreditExchangeRate || 0);
      if (fx.currency !== fx.baseCurrency && !(creditRate > 0)) {
        throw new Error("Customer refund requires the historical exchange rate of the customer credit");
      }
      const carryingRate = fx.currency === fx.baseCurrency ? 1 : creditRate;
      const refundFx = realizedFxForSettlement({
        direction: "PAYABLE",
        transactionAmount: amount,
        documentExchangeRate: carryingRate,
        settlementExchangeRate: fx.exchangeRate,
      });
      realizedFx = refundFx.signed;

      const customerCreditAccount = input.lines.find((line) => Number(line.debit || 0) > 0)?.accountId;
      if (!customerCreditAccount) throw new Error("Customer refund credit account could not be resolved");
      const partyRef = payment.customer?.code || payment.customerId || "";
      const projectRef = payment.project?.code || payment.projectId || input.projectId || "";
      const txn = (side: "debit" | "credit", rate: number) => ({
        transactionCurrency: fx.currency,
        exchangeRate: rate,
        transactionDebit: side === "debit" ? amount : 0,
        transactionCredit: side === "credit" ? amount : 0,
      });
      const baseOnly = {
        transactionCurrency: fx.baseCurrency,
        exchangeRate: 1,
        transactionDebit: 0,
        transactionCredit: 0,
      };

      postingLines = [
        {
          accountId: customerCreditAccount,
          debit: refundFx.documentBase,
          ...txn("debit", carryingRate),
          customerId: partyRef,
          projectId: projectRef,
          description: "Derecognize refundable customer credit",
        },
        {
          accountId: input.cashBankAccountId,
          credit: refundFx.settlementBase,
          ...txn("credit", fx.exchangeRate),
          customerId: partyRef,
          projectId: projectRef,
          description: "Customer refund payment",
        },
      ];
      if (refundFx.gain > 0) {
        postingLines.push({
          accountId: input.exchangeGainAccountId || INITIAL_ACCOUNT_IDS.exchangeGain,
          credit: refundFx.gain,
          ...baseOnly,
          projectId: projectRef,
          description: "Realized foreign exchange gain on customer refund",
        });
      }
      if (refundFx.loss > 0) {
        postingLines.push({
          accountId: input.exchangeLossAccountId || INITIAL_ACCOUNT_IDS.exchangeLoss,
          debit: refundFx.loss,
          ...baseOnly,
          projectId: projectRef,
          description: "Realized foreign exchange loss on customer refund",
        });
      }
    } else if (directAllocation && !directAllocation.alreadyAllocated) {
      const cashAccount = input.cashBankAccountId;
      const settlementAccount = input.lines.find(
        (line) => String(line.accountId || "").toUpperCase() !== String(cashAccount || "").toUpperCase(),
      )?.accountId;
      if (!settlementAccount) throw new Error("Payment settlement account could not be resolved");

      const partyRef = payment.customerId
        ? (payment.customer?.code || payment.customerId)
        : (payment.supplier?.code || payment.supplierId || "");
      const projectRef = payment.project?.code || payment.projectId || input.projectId || "";
      const transactionAudit = (side: "debit" | "credit", value: number, rate: number) => ({
        transactionCurrency: fx.currency,
        exchangeRate: rate,
        transactionDebit: side === "debit" ? value : 0,
        transactionCredit: side === "credit" ? value : 0,
      });
      const zeroFxAudit = {
        transactionCurrency: fx.baseCurrency,
        exchangeRate: 1,
        transactionDebit: 0,
        transactionCredit: 0,
      };

      if (payment.customerId) {
        postingLines = [
          {
            accountId: cashAccount,
            debit: directAllocation.settlementBaseAmount,
            ...transactionAudit("debit", amount, directAllocation.settlementExchangeRate),
            customerId: partyRef,
            projectId: projectRef,
            description: "Customer receipt",
          },
          {
            accountId: settlementAccount,
            credit: directAllocation.documentBaseAmount,
            ...transactionAudit("credit", amount, directAllocation.documentExchangeRate),
            customerId: partyRef,
            projectId: projectRef,
            description: "Settle Accounts Receivable",
          },
        ];
      } else {
        postingLines = [
          {
            accountId: settlementAccount,
            debit: directAllocation.documentBaseAmount,
            ...transactionAudit("debit", amount, directAllocation.documentExchangeRate),
            supplierId: partyRef,
            projectId: projectRef,
            description: "Settle Accounts Payable",
          },
          {
            accountId: cashAccount,
            credit: directAllocation.settlementBaseAmount,
            ...transactionAudit("credit", amount, directAllocation.settlementExchangeRate),
            supplierId: partyRef,
            projectId: projectRef,
            description: "Supplier payment",
          },
        ];
      }

      if (directAllocation.realizedGain > 0) {
        postingLines.push({
          accountId: input.exchangeGainAccountId || INITIAL_ACCOUNT_IDS.exchangeGain,
          credit: directAllocation.realizedGain,
          ...zeroFxAudit,
          projectId: projectRef,
          description: "Realized foreign exchange gain",
        });
      }
      if (directAllocation.realizedLoss > 0) {
        postingLines.push({
          accountId: input.exchangeLossAccountId || INITIAL_ACCOUNT_IDS.exchangeLoss,
          debit: directAllocation.realizedLoss,
          ...zeroFxAudit,
          projectId: projectRef,
          description: "Realized foreign exchange loss",
        });
      }
    } else {
      postingLines = input.lines.map((line) => ({
        ...line,
        debit: toBaseAmount(Number(line.debit || 0), fx.currency, fx.baseCurrency, fx.exchangeRate),
        credit: toBaseAmount(Number(line.credit || 0), fx.currency, fx.baseCurrency, fx.exchangeRate),
        transactionCurrency: fx.currency,
        exchangeRate: fx.exchangeRate,
        transactionDebit: Number(line.debit || 0),
        transactionCredit: Number(line.credit || 0),
      }));
    }

    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: input.documentType,
      documentId: payment.id,
      documentNumber: input.documentNumber,
      reference: input.reference || input.documentNumber,
      projectId: input.projectId,
      currency: fx.currency,
      baseCurrency: fx.baseCurrency,
      exchangeRate: fx.exchangeRate,
      createdBy: input.createdBy || "payment-final-save",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: postingLines,
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
      currency: fx.currency,
      baseCurrency: fx.baseCurrency,
      exchangeRate: fx.exchangeRate,
      baseAmount,
      realizedFx,
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

