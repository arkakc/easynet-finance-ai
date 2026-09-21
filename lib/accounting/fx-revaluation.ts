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
    const revaluationDateValue = new Date(`${revaluationDate}T00:00:00+10:00`);
    const existing = await tx.fxRevaluation.findUnique({
      where: {
        revaluationDate_baseCurrency: {
          revaluationDate: revaluationDateValue,
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

    const [invoices, bills] = await Promise.all([
      tx.invoice.findMany({
        where: {
          glPosted: true,
          outstanding: { gt: 0 },
          currency: { not: baseCurrency },
          issuedDate: { lte: revaluationDateValue },
          status: { in: ["SENT", "PARTIAL"] },
        },
        include: {
          customer: { select: { code: true } },
          project: { select: { code: true } },
        },
        orderBy: [{ currency: "asc" }, { issuedDate: "asc" }, { code: "asc" }],
      }),
      tx.supplierBill.findMany({
        where: {
          glPosted: true,
          outstanding: { gt: 0 },
          currency: { not: baseCurrency },
          billDate: { lte: revaluationDateValue },
          status: { in: ["SENT", "PARTIAL"] },
        },
        include: {
          supplier: { select: { code: true } },
          project: { select: { code: true } },
        },
        orderBy: [{ currency: "asc" }, { billDate: "asc" }, { code: "asc" }],
      }),
    ]);

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
      const documentFx = await resolveDocumentExchangeRate(tx, {
        currency: invoice.currency,
        exchangeRate: Number(invoice.exchangeRate || 0) || undefined,
        postingDate: invoice.issuedDate,
      });
      const closingRate = await latestExchangeRate(tx, {
        fromCurrency: invoice.currency,
        toCurrency: baseCurrency,
        rateDate: revaluationDate,
      });
      const outstanding = roundCurrency(Number(invoice.outstanding || 0));
      const historicalBase = Number(invoice.baseOutstanding || 0) > 0
        ? roundCurrency(Number(invoice.baseOutstanding))
        : roundCurrency(outstanding * documentFx.exchangeRate);
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
      const documentFx = await resolveDocumentExchangeRate(tx, {
        currency: bill.currency,
        exchangeRate: Number(bill.exchangeRate || 0) || undefined,
        postingDate: bill.billDate,
      });
      const closingRate = await latestExchangeRate(tx, {
        fromCurrency: bill.currency,
        toCurrency: baseCurrency,
        rateDate: revaluationDate,
      });
      const outstanding = roundCurrency(Number(bill.outstanding || 0));
      const historicalBase = Number(bill.baseOutstanding || 0) > 0
        ? roundCurrency(Number(bill.baseOutstanding))
        : roundCurrency(outstanding * documentFx.exchangeRate);
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
        revaluationDate: revaluationDateValue,
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
