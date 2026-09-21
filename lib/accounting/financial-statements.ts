import type { AccountTypeGL, PrismaClient } from "@prisma/client";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { prisma } from "@/src/lib/prisma";

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type StatementAccountRow = {
  code: string;
  name: string;
  type: AccountTypeGL;
  amount: number;
};

export type AgingBucket = "Current" | "1-30" | "31-60" | "61-90" | "90+";

export type AgingRow = {
  id: string;
  code: string;
  partyCode: string;
  partyName: string;
  dueDate: string | null;
  overdueDays: number;
  bucket: AgingBucket;
  outstanding: number;
  transactionCurrency?: string;
  transactionOutstanding?: number;
  historicalExchangeRate?: number;
};

export type FinancialStatements = {
  currency: string;
  period: { from: string; asOf: string };
  generatedAt: string;
  profitAndLoss: {
    revenue: StatementAccountRow[];
    expenses: StatementAccountRow[];
    totals: { revenue: number; expenses: number; netProfit: number };
  };
  balanceSheet: {
    assets: StatementAccountRow[];
    liabilities: StatementAccountRow[];
    equity: StatementAccountRow[];
    totals: { assets: number; liabilities: number; equity: number; currentEarnings: number; difference: number; balanced: boolean };
  };
  aging: {
    receivables: { rows: AgingRow[]; buckets: Record<AgingBucket, number>; total: number };
    payables: { rows: AgingRow[]; buckets: Record<AgingBucket, number>; total: number };
  };
  controls: {
    periodLedger: { debit: number; credit: number; difference: number; balanced: boolean };
    cumulativeLedger: { debit: number; credit: number; difference: number; balanced: boolean };
    receivables: { glBalance: number; subledgerBalance: number; difference: number; matched: boolean };
    payables: { glBalance: number; subledgerBalance: number; difference: number; matched: boolean };
  };
};

function accountingDate(value: string, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) throw new Error("Dates must use YYYY-MM-DD");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+10:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString("en-CA", { timeZone: "Pacific/Port_Moresby" }) !== value) {
    throw new Error("Invalid accounting date");
  }
  return date;
}

function fiscalYearStart(asOf: string, setting: string | null) {
  const monthDay = /^\d{2}-\d{2}$/.test(setting || "") ? setting! : "01-01";
  const year = Number(asOf.slice(0, 4)) - (asOf.slice(5) < monthDay ? 1 : 0);
  return `${year}-${monthDay}`;
}

export async function configuredFiscalYearStart(asOf: string, client: PrismaClient = prisma) {
  accountingDate(asOf, true);
  const setting = await client.globalSettings.findUnique({ where: { key: "fiscal_year_start" }, select: { value: true } });
  return fiscalYearStart(asOf, setting?.value || null);
}

function bucketFor(dueDate: Date | null, asOf: Date): { days: number; bucket: AgingBucket } {
  if (!dueDate) return { days: 0, bucket: "Current" };
  const due = new Date(dueDate.toLocaleDateString("en-CA", { timeZone: "Pacific/Port_Moresby" }) + "T00:00:00+10:00");
  const days = Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / 86_400_000));
  if (days === 0) return { days, bucket: "Current" };
  if (days <= 30) return { days, bucket: "1-30" };
  if (days <= 60) return { days, bucket: "31-60" };
  if (days <= 90) return { days, bucket: "61-90" };
  return { days, bucket: "90+" };
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
}

function pngDateText(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function accountCodeFromReference(value: string | null | undefined, fallback: string) {
  const clean = String(value || fallback).trim();
  return clean.toUpperCase().startsWith("ACC-") ? clean.slice(4) : clean;
}

export async function buildFinancialStatements(input: { from?: string; asOf: string }, client: PrismaClient = prisma): Promise<FinancialStatements> {
  const asOfDate = accountingDate(input.asOf, true);
  const from = input.from || await configuredFiscalYearStart(input.asOf, client);
  const fromDate = accountingDate(from);
  if (fromDate > asOfDate) throw new Error("from must be on or before asOf");

  const [accounts, periodBalances, cumulativeBalances, periodLedger, cumulativeLedger, invoices, bills, baseCurrencySetting, activeFxRevaluations] = await Promise.all([
    client.chartOfAccounts.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, type: true, parentId: true } }),
    client.journalLine.groupBy({
      by: ["accountId"],
      where: { journal: { status: "POSTED", date: { gte: fromDate, lte: asOfDate } } },
      _sum: { debit: true, credit: true },
    }),
    client.journalLine.groupBy({
      by: ["accountId"],
      where: { journal: { status: "POSTED", date: { lte: asOfDate } } },
      _sum: { debit: true, credit: true },
    }),
    client.journalHeader.aggregate({ where: { status: "POSTED", date: { gte: fromDate, lte: asOfDate } }, _sum: { totalDebit: true, totalCredit: true } }),
    client.journalHeader.aggregate({ where: { status: "POSTED", date: { lte: asOfDate } }, _sum: { totalDebit: true, totalCredit: true } }),
    client.invoice.findMany({
      where: {
        issuedDate: { lte: asOfDate },
        glPosted: true,
        code: { not: { startsWith: "CN-" } },
      },
      include: {
        customer: { select: { code: true, name: true } },
        paymentAllocations: {
          where: {
            allocationDate: { lte: asOfDate },
            OR: [{ reversalDate: null }, { reversalDate: { gt: asOfDate } }],
          },
          select: { amount: true, baseAmount: true },
        },
        originalCreditNotes: {
          where: { issueDate: { lte: asOfDate }, glPosted: true },
          select: { total: true, journalId: true, status: true },
        },
      },
      orderBy: [{ dueDate: "asc" }, { code: "asc" }],
    }),
    client.supplierBill.findMany({
      where: { billDate: { lte: asOfDate }, glPosted: true },
      include: {
        supplier: { select: { code: true, name: true } },
        paymentAllocations: {
          where: {
            allocationDate: { lte: asOfDate },
            OR: [{ reversalDate: null }, { reversalDate: { gt: asOfDate } }],
          },
          select: { amount: true, baseAmount: true },
        },
        refunds: {
          where: { refundDate: { lte: asOfDate }, glPosted: true },
          select: { total: true, journalId: true, status: true },
        },
      },
      orderBy: [{ dueDate: "asc" }, { code: "asc" }],
    }),
    client.globalSettings.findMany({
      where: {
        key: {
          in: [
            "currency",
            "base_currency",
            "default_receivable_account",
            "default_payable_account",
          ],
        },
      },
      select: { key: true, value: true },
    }),
    client.fxRevaluationLine.findMany({
      where: {
        revaluation: {
          revaluationDate: { lte: asOfDate },
          reversalDate: { gt: asOfDate },
          status: "POSTED",
        },
      },
      select: { documentType: true, documentId: true, baseDifference: true },
    }),
  ]);

  const sourceJournalCodes = [
    ...invoices.map((row) => String(row.journalId || "")).filter(Boolean),
    ...bills.map((row) => String(row.journalId || "")).filter(Boolean),
    ...invoices.flatMap((row) => row.originalCreditNotes.map((credit) => String(credit.journalId || ""))).filter(Boolean),
    ...bills.flatMap((row) => row.refunds.map((refund) => String(refund.journalId || ""))).filter(Boolean),
  ];
  const sourceJournals = sourceJournalCodes.length
    ? await client.journalHeader.findMany({
        where: { code: { in: [...new Set(sourceJournalCodes)] } },
        select: { id: true, code: true },
      })
    : [];
  const sourceJournalCodeById = new Map(sourceJournals.map((row) => [row.id, row.code]));
  const reversalRows = sourceJournals.length
    ? await client.journalHeader.findMany({
        where: {
          reversalOfJournalId: { in: sourceJournals.map((row) => row.id) },
          status: "POSTED",
        },
        select: { reversalOfJournalId: true, date: true },
        orderBy: { date: "asc" },
      })
    : [];
  const reversalDateBySourceCode = new Map<string, Date>();
  for (const row of reversalRows) {
    if (!row.reversalOfJournalId) continue;
    const code = sourceJournalCodeById.get(row.reversalOfJournalId);
    if (!code || reversalDateBySourceCode.has(code)) continue;
    reversalDateBySourceCode.set(code, row.date);
  }
  const activeAsOf = (journalCode: string | null | undefined, currentStatus: string) => {
    const reversalDate = journalCode ? reversalDateBySourceCode.get(journalCode) : undefined;
    if (reversalDate && reversalDate <= asOfDate) return false;
    const cancelledNow = ["CANCELLED", "VOID"].includes(String(currentStatus || "").toUpperCase());
    if (cancelledNow && !reversalDate) return false;
    return true;
  };
  const activeInvoices = invoices.filter((row) => activeAsOf(row.journalId, row.status));
  const activeBills = bills.filter((row) => activeAsOf(row.journalId, row.status));

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const periodById = new Map(periodBalances.map((row) => [row.accountId, round(Number(row._sum.debit || 0) - Number(row._sum.credit || 0))]));
  const cumulativeById = new Map(cumulativeBalances.map((row) => [row.accountId, round(Number(row._sum.debit || 0) - Number(row._sum.credit || 0))]));

  const rowsFor = (types: AccountTypeGL[], balances: Map<string, number>, creditNormal: boolean) => accounts
    .filter((account) => types.includes(account.type) && Math.abs(balances.get(account.id) || 0) >= 0.005)
    .map((account) => ({ code: account.code, name: account.name, type: account.type, amount: round((balances.get(account.id) || 0) * (creditNormal ? -1 : 1)) }));

  const revenue = rowsFor(["REVENUE"], periodById, true);
  const expenses = rowsFor(["EXPENSE"], periodById, false);
  const assets = rowsFor(["ASSET", "CONTRA_ASSET"], cumulativeById, false);
  const liabilities = rowsFor(["LIABILITY", "CONTRA_LIABILITY"], cumulativeById, true);
  const equity = rowsFor(["EQUITY"], cumulativeById, true);
  const total = (rows: StatementAccountRow[]) => round(rows.reduce((sum, row) => sum + row.amount, 0));
  const totalRevenue = total(revenue);
  const totalExpenses = total(expenses);
  const netProfit = round(totalRevenue - totalExpenses);

  const cumulativeRevenue = total(rowsFor(["REVENUE"], cumulativeById, true));
  const cumulativeExpenses = total(rowsFor(["EXPENSE"], cumulativeById, false));
  const currentEarnings = round(cumulativeRevenue - cumulativeExpenses);
  const totalAssets = total(assets);
  const totalLiabilities = total(liabilities);
  const totalEquity = total(equity);
  const equationDifference = round(totalAssets - totalLiabilities - totalEquity - currentEarnings);

  const baseCurrency = String(
    baseCurrencySetting.find((row) => row.key === "currency")?.value
    || baseCurrencySetting.find((row) => row.key === "base_currency")?.value
    || "PGK",
  ).trim().toUpperCase() || "PGK";
  const activeRevaluationByDocument = new Map<string, number>();
  for (const row of activeFxRevaluations) {
    activeRevaluationByDocument.set(
      row.documentId,
      round((activeRevaluationByDocument.get(row.documentId) || 0) + Number(row.baseDifference || 0)),
    );
  }

  const receivableRows: AgingRow[] = activeInvoices.map((invoice) => {
    const aging = bucketFor(invoice.dueDate, asOfDate);
    const rate = Number(invoice.exchangeRate || 1);
    const transactionReceipts = invoice.paymentAllocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
    const transactionCredits = invoice.originalCreditNotes
      .filter((credit) => activeAsOf(credit.journalId, credit.status))
      .reduce((sum, credit) => sum + Number(credit.total), 0);
    const transactionOutstanding = round(Math.max(0, Number(invoice.total) - transactionReceipts - transactionCredits));
    const baseTotal = Number(invoice.baseTotal || 0) > 0 ? Number(invoice.baseTotal) : round(Number(invoice.total || 0) * rate);
    const baseReceipts = invoice.paymentAllocations.reduce((sum, allocation) => {
      const stored = Number(allocation.baseAmount || 0);
      return sum + (stored > 0 ? stored : round(Number(allocation.amount || 0) * rate));
    }, 0);
    const baseCredits = round(transactionCredits * rate);
    const historicalOutstanding = round(Math.max(0, baseTotal - baseReceipts - baseCredits));
    const outstanding = round(Math.max(0, historicalOutstanding + (activeRevaluationByDocument.get(invoice.id) || 0)));
    return {
      id: invoice.id,
      code: invoice.code,
      partyCode: invoice.customer.code,
      partyName: invoice.customer.name,
      dueDate: pngDateText(invoice.dueDate),
      overdueDays: aging.days,
      bucket: aging.bucket,
      outstanding,
      transactionCurrency: invoice.currency,
      transactionOutstanding,
      historicalExchangeRate: rate,
    };
  }).filter((invoice) => invoice.outstanding >= 0.005);
  const payableRows: AgingRow[] = activeBills.map((bill) => {
    const aging = bucketFor(bill.dueDate, asOfDate);
    const rate = Number(bill.exchangeRate || 1);
    const transactionPayments = bill.paymentAllocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
    const transactionCredits = bill.refunds
      .filter((refund) => activeAsOf(refund.journalId, refund.status))
      .reduce((sum, refund) => sum + Number(refund.total), 0);
    const transactionOutstanding = round(Math.max(0, Number(bill.total) - transactionPayments - transactionCredits));
    const baseTotal = Number(bill.baseTotal || 0) > 0 ? Number(bill.baseTotal) : round(Number(bill.total || 0) * rate);
    const basePayments = bill.paymentAllocations.reduce((sum, allocation) => {
      const stored = Number(allocation.baseAmount || 0);
      return sum + (stored > 0 ? stored : round(Number(allocation.amount || 0) * rate));
    }, 0);
    const baseCredits = round(transactionCredits * rate);
    const historicalOutstanding = round(Math.max(0, baseTotal - basePayments - baseCredits));
    const outstanding = round(Math.max(0, historicalOutstanding + (activeRevaluationByDocument.get(bill.id) || 0)));
    return {
      id: bill.id,
      code: bill.code,
      partyCode: bill.supplier.code,
      partyName: bill.supplier.name,
      dueDate: pngDateText(bill.dueDate),
      overdueDays: aging.days,
      bucket: aging.bucket,
      outstanding,
      transactionCurrency: bill.currency,
      transactionOutstanding,
      historicalExchangeRate: rate,
    };
  }).filter((bill) => bill.outstanding >= 0.005);
  const agingSummary = (rows: AgingRow[]) => {
    const buckets = emptyBuckets();
    for (const row of rows) buckets[row.bucket] = round(buckets[row.bucket] + row.outstanding);
    return { rows, buckets, total: round(rows.reduce((sum, row) => sum + row.outstanding, 0)) };
  };
  const receivables = agingSummary(receivableRows);
  const payables = agingSummary(payableRows);

  const children = new Map<string, string[]>();
  for (const account of accounts) if (account.parentId) children.set(account.parentId, [...(children.get(account.parentId) || []), account.id]);
  const rolledBalance = (code: string, creditNormal: boolean, legacyFamily = false) => {
    const root = accounts.find((account) => account.code === code);
    const ids = root ? [root.id] : [];
    if (legacyFamily) {
      const legacyPrefix = code.slice(0, -1);
      ids.push(...accounts.filter((account) => account.code.startsWith(legacyPrefix)).map((account) => account.id));
    }
    for (let index = 0; index < ids.length; index += 1) ids.push(...(children.get(ids[index]) || []));
    const raw = [...new Set(ids)].reduce((sum, id) => sum + (cumulativeById.get(id) || 0), 0);
    return round(raw * (creditNormal ? -1 : 1));
  };
  const arConfigured = baseCurrencySetting.find((row) => row.key === "default_receivable_account")?.value;
  const apConfigured = baseCurrencySetting.find((row) => row.key === "default_payable_account")?.value;
  const arControlCode = accountCodeFromReference(arConfigured, INITIAL_ACCOUNT_IDS.accountsReceivable);
  const apControlCode = accountCodeFromReference(apConfigured, INITIAL_ACCOUNT_IDS.accountsPayable);
  const arGl = rolledBalance(arControlCode, false, !arConfigured);
  const apGl = rolledBalance(apControlCode, true, !apConfigured);
  const periodDebit = round(Number(periodLedger._sum.totalDebit || 0));
  const periodCredit = round(Number(periodLedger._sum.totalCredit || 0));
  const cumulativeDebit = round(Number(cumulativeLedger._sum.totalDebit || 0));
  const cumulativeCredit = round(Number(cumulativeLedger._sum.totalCredit || 0));

  return {
    currency: baseCurrency,
    period: { from, asOf: input.asOf },
    generatedAt: new Date().toISOString(),
    profitAndLoss: { revenue, expenses, totals: { revenue: totalRevenue, expenses: totalExpenses, netProfit } },
    balanceSheet: { assets, liabilities, equity, totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, currentEarnings, difference: equationDifference, balanced: Math.abs(equationDifference) < 0.01 } },
    aging: { receivables, payables },
    controls: {
      periodLedger: { debit: periodDebit, credit: periodCredit, difference: round(periodDebit - periodCredit), balanced: Math.abs(periodDebit - periodCredit) < 0.01 },
      cumulativeLedger: { debit: cumulativeDebit, credit: cumulativeCredit, difference: round(cumulativeDebit - cumulativeCredit), balanced: Math.abs(cumulativeDebit - cumulativeCredit) < 0.01 },
      receivables: { glBalance: arGl, subledgerBalance: receivables.total, difference: round(arGl - receivables.total), matched: Math.abs(arGl - receivables.total) < 0.01 },
      payables: { glBalance: apGl, subledgerBalance: payables.total, difference: round(apGl - payables.total), matched: Math.abs(apGl - payables.total) < 0.01 },
    },
  };
}
