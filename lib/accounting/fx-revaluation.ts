import type { AtomicPostingLine } from "@/lib/accounting/atomic-posting";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import {
  companyBaseCurrency,
  latestExchangeRate,
  resolveDocumentExchangeRate,
  roundCurrency,
} from "@/lib/accounting/currency";

function nextAccountingDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("A valid revaluation date is required");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function postFxRevaluationAtomic(input: {
  revaluationDate: string;
  receivableAccountId: string;
  payableAccountId: string;
  exchangeGainAccountId: string;
  exchangeLossAccountId: string;
  createdBy?: string;
  approvedBy?: string;
}) {
  const revaluationDate = String(input.revaluationDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(revaluationDate)) {
    throw new Error("A valid revaluation date is required");
  }
  const reversalDate = nextAccountingDate(revaluationDate);

  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const baseCurrency = await companyBaseCurrency(tx);
    const revaluationDateValue = new Date(`${revaluationDate}T23:59:59+10:00`);
    const revaluationPostingDate = new Date(`${revaluationDate}T00:00:00+10:00`);

    const existing = await tx.fxRevaluation.findUnique({
      where: {
        revaluationDate_baseCurrency: {
          revaluationDate: revaluationPostingDate,
          baseCurrency,
        },
      },
    });
    if (existing) {
      return {
        revaluationId: existing.id,
        revaluationCode: existing.code,
        journalId: existing.journalId,
        reversalJournalId: existing.reversalJournalId,
        totalGain: Number(existing.totalGain || 0),
        totalLoss: Number(existing.totalLoss || 0),
        alreadyPosted: true,
      };
    }

    // Reconstruct open monetary items as-of the closing date rather than using
    // today's outstanding/status. This keeps retrospective period close correct
    // even when later payments were posted before the controller ran revaluation.
    const [invoices, bills, postedInvoiceCredits, foreignBankAccounts] = await Promise.all([
      tx.invoice.findMany({
        where: {
          glPosted: true,
          issuedDate: { lte: revaluationDateValue },
          currency: { not: baseCurrency },
          code: { not: { startsWith: "CN-" } },
          status: { notIn: ["CANCELLED"] },
        },
        include: {
          customer: { select: { code: true } },
          project: { select: { code: true } },
          paymentAllocations: {
            where: {
              allocationDate: { lte: revaluationDateValue },
              OR: [{ reversalDate: null }, { reversalDate: { gt: revaluationDateValue } }],
            },
            select: { amount: true, baseAmount: true },
          },
          originalCreditNotes: {
            where: {
              issueDate: { lte: revaluationDateValue },
              glPosted: true,
              status: { not: "CANCELLED" },
            },
            select: { total: true },
          },
        },
        orderBy: [{ currency: "asc" }, { issuedDate: "asc" }, { code: "asc" }],
      }),
      tx.supplierBill.findMany({
        where: {
          glPosted: true,
          billDate: { lte: revaluationDateValue },
          currency: { not: baseCurrency },
          status: { notIn: ["CANCELLED"] },
        },
        include: {
          supplier: { select: { code: true } },
          project: { select: { code: true } },
          paymentAllocations: {
            where: {
              allocationDate: { lte: revaluationDateValue },
              OR: [{ reversalDate: null }, { reversalDate: { gt: revaluationDateValue } }],
            },
            select: { amount: true, baseAmount: true },
          },
          refunds: {
            where: {
              refundDate: { lte: revaluationDateValue },
              glPosted: true,
              status: { not: "CANCELLED" },
            },
            select: { total: true },
          },
        },
        orderBy: [{ currency: "asc" }, { billDate: "asc" }, { code: "asc" }],
      }),
      tx.invoice.findMany({
        where: {
          code: { startsWith: "CN-" },
          glPosted: true,
          issuedDate: { lte: revaluationDateValue },
          sourceDocId: { not: null },
          status: { notIn: ["CANCELLED", "VOID"] },
        },
        select: {
          id: true,
          sourceDocId: true,
          total: true,
          baseTotal: true,
          journalId: true,
        },
      }),
      tx.bankAccount.findMany({
        where: {
          isActive: true,
          chartOfAccountsId: { not: null },
          currency: { not: baseCurrency },
        },
        select: {
          id: true,
          code: true,
          name: true,
          currency: true,
          chartOfAccountsId: true,
        },
        orderBy: { code: "asc" },
      }),
    ]);

    const sourceJournalCodes = [
      ...invoices.map((row) => String(row.journalId || "")).filter(Boolean),
      ...bills.map((row) => String(row.journalId || "")).filter(Boolean),
      ...postedInvoiceCredits.map((row) => String(row.journalId || "")).filter(Boolean),
    ];
    const sourceJournals = sourceJournalCodes.length
      ? await tx.journalHeader.findMany({
          where: { code: { in: [...new Set(sourceJournalCodes)] } },
          select: { id: true, code: true },
        })
      : [];
    const sourceJournalById = new Map(sourceJournals.map((row) => [row.id, row.code]));
    const reversalsAsOf = sourceJournals.length
      ? await tx.journalHeader.findMany({
          where: {
            reversalOfJournalId: { in: sourceJournals.map((row) => row.id) },
            status: "POSTED",
            date: { lte: revaluationDateValue },
          },
          select: { reversalOfJournalId: true },
        })
      : [];
    const reversedSourceCodesAsOf = new Set(
      reversalsAsOf
        .map((row) => row.reversalOfJournalId ? sourceJournalById.get(row.reversalOfJournalId) : "")
        .filter((code): code is string => Boolean(code)),
    );

    const creditInvoiceByOriginal = new Map<string, { transaction: number; base: number }>();
    for (const credit of postedInvoiceCredits) {
      if (credit.journalId && reversedSourceCodesAsOf.has(credit.journalId)) continue;
      const key = String(credit.sourceDocId || "");
      if (!key) continue;
      const current = creditInvoiceByOriginal.get(key) || { transaction: 0, base: 0 };
      current.transaction = roundCurrency(current.transaction + Number(credit.total || 0));
      current.base = roundCurrency(current.base + Number(credit.baseTotal || 0));
      creditInvoiceByOriginal.set(key, current);
    }

    const journalLines: AtomicPostingLine[] = [];
    const detailRows: Array<{
      documentType: string;
      documentId: string;
      documentNumber: string;
      partyType: string;
      partyId: string;
      projectId: string | null;
      currency: string;
      outstandingAmount: number;
      historicalBase: number;
      closingRate: number;
      closingBase: number;
      baseDifference: number;
      gainAmount: number;
      lossAmount: number;
    }> = [];

    let totalGain = 0;
    let totalLoss = 0;

    for (const invoice of invoices) {
      if (invoice.journalId && reversedSourceCodesAsOf.has(invoice.journalId)) continue;
      const documentFx = await resolveDocumentExchangeRate(tx, {
        currency: invoice.currency,
        exchangeRate: Number(invoice.exchangeRate || 0) || undefined,
        postingDate: invoice.issuedDate,
      });

      const allocationTransaction = roundCurrency(
        invoice.paymentAllocations.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      );
      const allocationBase = roundCurrency(
        invoice.paymentAllocations.reduce((sum, row) => {
          const stored = Number(row.baseAmount || 0);
          return sum + (stored > 0 ? stored : Number(row.amount || 0) * documentFx.exchangeRate);
        }, 0),
      );
      const legacyCreditTransaction = roundCurrency(
        invoice.originalCreditNotes.reduce((sum, row) => sum + Number(row.total || 0), 0),
      );
      const invoiceCredit = creditInvoiceByOriginal.get(invoice.id) || { transaction: 0, base: 0 };
      const creditTransaction = roundCurrency(legacyCreditTransaction + invoiceCredit.transaction);
      const creditBase = roundCurrency(
        legacyCreditTransaction * documentFx.exchangeRate
        + (invoiceCredit.base > 0
          ? invoiceCredit.base
          : invoiceCredit.transaction * documentFx.exchangeRate),
      );

      const outstanding = roundCurrency(
        Math.max(0, Number(invoice.total || 0) - allocationTransaction - creditTransaction),
      );
      if (outstanding <= 0.005) continue;

      const baseTotal = Number(invoice.baseTotal || 0) > 0
        ? roundCurrency(Number(invoice.baseTotal))
        : roundCurrency(Number(invoice.total || 0) * documentFx.exchangeRate);
      const historicalBase = roundCurrency(Math.max(0, baseTotal - allocationBase - creditBase));
      const closingRate = await latestExchangeRate(tx, {
        fromCurrency: invoice.currency,
        toCurrency: baseCurrency,
        rateDate: revaluationDate,
      });
      const closingBase = roundCurrency(outstanding * closingRate);
      const difference = roundCurrency(closingBase - historicalBase);
      if (Math.abs(difference) < 0.01) continue;

      const partyRef = invoice.customer?.code || invoice.customerId;
      const projectRef = invoice.project?.code || invoice.projectId || undefined;
      const baseAudit = {
        transactionCurrency: baseCurrency,
        exchangeRate: 1,
      };

      let gain = 0;
      let loss = 0;
      if (difference > 0) {
        gain = difference;
        journalLines.push(
          {
            accountId: input.receivableAccountId,
            debit: difference,
            ...baseAudit,
            transactionDebit: difference,
            transactionCredit: 0,
            customerId: partyRef,
            projectId: projectRef,
            description: `FX revaluation receivable ${invoice.code}`,
          },
          {
            accountId: input.exchangeGainAccountId,
            credit: difference,
            ...baseAudit,
            transactionDebit: 0,
            transactionCredit: difference,
            projectId: projectRef,
            description: `Unrealized FX gain ${invoice.code}`,
          },
        );
      } else {
        loss = Math.abs(difference);
        journalLines.push(
          {
            accountId: input.exchangeLossAccountId,
            debit: loss,
            ...baseAudit,
            transactionDebit: loss,
            transactionCredit: 0,
            projectId: projectRef,
            description: `Unrealized FX loss ${invoice.code}`,
          },
          {
            accountId: input.receivableAccountId,
            credit: loss,
            ...baseAudit,
            transactionDebit: 0,
            transactionCredit: loss,
            customerId: partyRef,
            projectId: projectRef,
            description: `FX revaluation receivable ${invoice.code}`,
          },
        );
      }

      totalGain = roundCurrency(totalGain + gain);
      totalLoss = roundCurrency(totalLoss + loss);
      detailRows.push({
        documentType: "Sales Invoice",
        documentId: invoice.id,
        documentNumber: invoice.code,
        partyType: "Customer",
        partyId: partyRef,
        projectId: invoice.projectId,
        currency: invoice.currency,
        outstandingAmount: outstanding,
        historicalBase,
        closingRate,
        closingBase,
        baseDifference: difference,
        gainAmount: gain,
        lossAmount: loss,
      });
    }

    for (const bill of bills) {
      if (bill.journalId && reversedSourceCodesAsOf.has(bill.journalId)) continue;
      const documentFx = await resolveDocumentExchangeRate(tx, {
        currency: bill.currency,
        exchangeRate: Number(bill.exchangeRate || 0) || undefined,
        postingDate: bill.billDate,
      });

      const allocationTransaction = roundCurrency(
        bill.paymentAllocations.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      );
      const allocationBase = roundCurrency(
        bill.paymentAllocations.reduce((sum, row) => {
          const stored = Number(row.baseAmount || 0);
          return sum + (stored > 0 ? stored : Number(row.amount || 0) * documentFx.exchangeRate);
        }, 0),
      );
      const refundTransaction = roundCurrency(
        bill.refunds.reduce((sum, row) => sum + Number(row.total || 0), 0),
      );
      const refundBase = roundCurrency(refundTransaction * documentFx.exchangeRate);

      const outstanding = roundCurrency(
        Math.max(0, Number(bill.total || 0) - allocationTransaction - refundTransaction),
      );
      if (outstanding <= 0.005) continue;

      const baseTotal = Number(bill.baseTotal || 0) > 0
        ? roundCurrency(Number(bill.baseTotal))
        : roundCurrency(Number(bill.total || 0) * documentFx.exchangeRate);
      const historicalBase = roundCurrency(Math.max(0, baseTotal - allocationBase - refundBase));
      const closingRate = await latestExchangeRate(tx, {
        fromCurrency: bill.currency,
        toCurrency: baseCurrency,
        rateDate: revaluationDate,
      });
      const closingBase = roundCurrency(outstanding * closingRate);
      const difference = roundCurrency(closingBase - historicalBase);
      if (Math.abs(difference) < 0.01) continue;

      const partyRef = bill.supplier?.code || bill.supplierId;
      const projectRef = bill.project?.code || bill.projectId || undefined;
      const baseAudit = {
        transactionCurrency: baseCurrency,
        exchangeRate: 1,
      };

      let gain = 0;
      let loss = 0;
      if (difference > 0) {
        loss = difference;
        journalLines.push(
          {
            accountId: input.exchangeLossAccountId,
            debit: difference,
            ...baseAudit,
            transactionDebit: difference,
            transactionCredit: 0,
            projectId: projectRef,
            description: `Unrealized FX loss ${bill.code}`,
          },
          {
            accountId: input.payableAccountId,
            credit: difference,
            ...baseAudit,
            transactionDebit: 0,
            transactionCredit: difference,
            supplierId: partyRef,
            projectId: projectRef,
            description: `FX revaluation payable ${bill.code}`,
          },
        );
      } else {
        gain = Math.abs(difference);
        journalLines.push(
          {
            accountId: input.payableAccountId,
            debit: gain,
            ...baseAudit,
            transactionDebit: gain,
            transactionCredit: 0,
            supplierId: partyRef,
            projectId: projectRef,
            description: `FX revaluation payable ${bill.code}`,
          },
          {
            accountId: input.exchangeGainAccountId,
            credit: gain,
            ...baseAudit,
            transactionDebit: 0,
            transactionCredit: gain,
            projectId: projectRef,
            description: `Unrealized FX gain ${bill.code}`,
          },
        );
      }

      totalGain = roundCurrency(totalGain + gain);
      totalLoss = roundCurrency(totalLoss + loss);
      detailRows.push({
        documentType: "Supplier Invoice",
        documentId: bill.id,
        documentNumber: bill.code,
        partyType: "Supplier",
        partyId: partyRef,
        projectId: bill.projectId,
        currency: bill.currency,
        outstandingAmount: outstanding,
        historicalBase,
        closingRate,
        closingBase,
        baseDifference: difference,
        gainAmount: gain,
        lossAmount: loss,
      });
    }

    for (const bank of foreignBankAccounts) {
      if (!bank.chartOfAccountsId) continue;
      const bankLines = await tx.journalLine.findMany({
        where: {
          accountId: bank.chartOfAccountsId,
          journal: {
            status: "POSTED",
            date: { lte: revaluationDateValue },
          },
        },
        select: {
          debit: true,
          credit: true,
          transactionCurrency: true,
          transactionDebit: true,
          transactionCredit: true,
        },
      });

      const transactionBalance = roundCurrency(
        bankLines
          .filter((line) => String(line.transactionCurrency || "").toUpperCase() === bank.currency.toUpperCase())
          .reduce(
            (sum, line) => sum + Number(line.transactionDebit || 0) - Number(line.transactionCredit || 0),
            0,
          ),
      );
      if (Math.abs(transactionBalance) <= 0.005) continue;

      const historicalBase = roundCurrency(
        bankLines.reduce(
          (sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0),
          0,
        ),
      );
      const closingRate = await latestExchangeRate(tx, {
        fromCurrency: bank.currency,
        toCurrency: baseCurrency,
        rateDate: revaluationDate,
      });
      const closingBase = roundCurrency(transactionBalance * closingRate);
      const difference = roundCurrency(closingBase - historicalBase);
      if (Math.abs(difference) < 0.01) continue;

      const baseAudit = {
        transactionCurrency: baseCurrency,
        exchangeRate: 1,
      };
      let gain = 0;
      let loss = 0;

      if (difference > 0) {
        gain = difference;
        journalLines.push(
          {
            accountId: bank.chartOfAccountsId,
            debit: difference,
            ...baseAudit,
            transactionDebit: difference,
            transactionCredit: 0,
            description: `FX revaluation bank ${bank.code}`,
          },
          {
            accountId: input.exchangeGainAccountId,
            credit: difference,
            ...baseAudit,
            transactionDebit: 0,
            transactionCredit: difference,
            description: `Unrealized FX gain on bank ${bank.code}`,
          },
        );
      } else {
        loss = Math.abs(difference);
        journalLines.push(
          {
            accountId: input.exchangeLossAccountId,
            debit: loss,
            ...baseAudit,
            transactionDebit: loss,
            transactionCredit: 0,
            description: `Unrealized FX loss on bank ${bank.code}`,
          },
          {
            accountId: bank.chartOfAccountsId,
            credit: loss,
            ...baseAudit,
            transactionDebit: 0,
            transactionCredit: loss,
            description: `FX revaluation bank ${bank.code}`,
          },
        );
      }

      totalGain = roundCurrency(totalGain + gain);
      totalLoss = roundCurrency(totalLoss + loss);
      detailRows.push({
        documentType: "Bank Account",
        documentId: bank.id,
        documentNumber: bank.code,
        partyType: "Bank",
        partyId: bank.code,
        projectId: null,
        currency: bank.currency,
        outstandingAmount: transactionBalance,
        historicalBase,
        closingRate,
        closingBase,
        baseDifference: difference,
        gainAmount: gain,
        lossAmount: loss,
      });
    }

    if (!journalLines.length) {
      return {
        revaluationId: "",
        revaluationCode: "",
        journalId: "",
        reversalJournalId: "",
        totalGain: 0,
        totalLoss: 0,
        lineCount: 0,
        alreadyPosted: false,
        noAdjustmentRequired: true,
      };
    }

    const code = documentSeriesId("FX Revaluation");
    const journal = await postJournal({
      postingDate: revaluationDate,
      documentType: "FX_REVALUATION",
      documentId: code,
      documentNumber: code,
      reference: `Foreign currency revaluation at ${revaluationDate}`,
      currency: baseCurrency,
      baseCurrency,
      exchangeRate: 1,
      createdBy: input.createdBy || "fx-revaluation",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: journalLines,
    });

    const reversalLines = journalLines.map((line) => ({
      ...line,
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      transactionDebit: Number(line.transactionCredit || 0),
      transactionCredit: Number(line.transactionDebit || 0),
      description: `Auto reverse: ${line.description || "FX revaluation"}`,
    }));

    const reversal = await postJournal({
      postingDate: reversalDate,
      documentType: "FX_REVALUATION_REVERSAL",
      documentId: `${code}-REV`,
      documentNumber: `${code}-REV`,
      reference: `Automatic reversal of ${code}`,
      currency: baseCurrency,
      baseCurrency,
      exchangeRate: 1,
      createdBy: input.createdBy || "fx-revaluation",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: reversalLines,
    });

    const record = await tx.fxRevaluation.create({
      data: {
        code,
        revaluationDate: revaluationPostingDate,
        reversalDate: new Date(`${reversalDate}T00:00:00+10:00`),
        baseCurrency,
        status: "POSTED",
        totalGain,
        totalLoss,
        journalId: journal.journalId,
        reversalJournalId: reversal.journalId,
        createdBy: input.createdBy || "fx-revaluation",
        lines: { create: detailRows },
      },
      include: { lines: true },
    });

    return {
      revaluationId: record.id,
      revaluationCode: record.code,
      journalId: journal.journalId,
      reversalJournalId: reversal.journalId,
      revaluationDate,
      reversalDate,
      baseCurrency,
      totalGain,
      totalLoss,
      lineCount: record.lines.length,
      alreadyPosted: false,
      noAdjustmentRequired: false,
    };
  });
}
