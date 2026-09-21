import type { PrismaClient } from "@prisma/client";
import { companyBaseCurrency } from "@/lib/accounting/currency";
import { prisma } from "@/src/lib/prisma";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const round = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export type TrialBalanceRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  balance: number;
};

export type TrialBalance = {
  currency: string;
  period: { startDate: string | null; asOf: string };
  generatedAt: string;
  accounts: TrialBalanceRow[];
  totals: { debit: number; credit: number; difference: number; balanced: boolean };
};

function accountingDate(value: string, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) throw new Error("Dates must use YYYY-MM-DD");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+10:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid accounting date");
  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  if (normalized !== value) throw new Error("Invalid accounting date");
  return date;
}

export async function buildTrialBalance(
  input: { startDate?: string | null; asOf: string },
  client: PrismaClient = prisma,
): Promise<TrialBalance> {
  const asOfDate = accountingDate(input.asOf, true);
  const startDateText = input.startDate || null;
  const startDate = startDateText ? accountingDate(startDateText) : null;
  if (startDate && startDate > asOfDate) throw new Error("startDate must be on or before asOf");

  const [lines, baseCurrency] = await Promise.all([
    client.journalLine.findMany({
      where: {
        journal: {
          status: "POSTED",
          date: {
            ...(startDate ? { gte: startDate } : {}),
            lte: asOfDate,
          },
        },
      },
      include: { account: true },
      orderBy: [{ account: { code: "asc" } }, { journal: { date: "asc" } }, { lineNo: "asc" }],
    }),
    client.$transaction((tx) => companyBaseCurrency(tx)),
  ]);

  const balances = new Map<string, TrialBalanceRow>();
  for (const line of lines) {
    const current = balances.get(line.accountId) || {
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      accountType: String(line.account.type),
      debit: 0,
      credit: 0,
      balance: 0,
    };
    current.debit += Number(line.debit || 0);
    current.credit += Number(line.credit || 0);
    balances.set(line.accountId, current);
  }

  const accounts = [...balances.values()]
    .map((row) => {
      const debit = round(row.debit);
      const credit = round(row.credit);
      return { ...row, debit, credit, balance: round(debit - credit) };
    })
    .filter((row) => Math.abs(row.debit) >= 0.005 || Math.abs(row.credit) >= 0.005)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const totalDebit = round(accounts.reduce((sum, row) => sum + row.debit, 0));
  const totalCredit = round(accounts.reduce((sum, row) => sum + row.credit, 0));
  const difference = round(totalDebit - totalCredit);

  return {
    currency: baseCurrency,
    period: { startDate: startDateText, asOf: input.asOf },
    generatedAt: new Date().toISOString(),
    accounts,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      difference,
      balanced: Math.abs(difference) < 0.01,
    },
  };
}
