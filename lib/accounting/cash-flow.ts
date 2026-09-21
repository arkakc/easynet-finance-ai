import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type CashFlowCategory = "Operating" | "Investing" | "Financing" | "Exchange Rate Effect";

export type CashFlowRow = {
  journalId: string;
  journalCode: string;
  date: string;
  category: CashFlowCategory;
  documentType: string;
  reference: string;
  description: string;
  movement: number;
};

export type CashFlowStatement = {
  currency: string;
  period: { from: string; asOf: string };
  generatedAt: string;
  rows: CashFlowRow[];
  cashAccounts: Array<{ code: string; name: string }>;
  totals: {
    openingCash: number;
    operating: number;
    investing: number;
    financing: number;
    netCashFlow: number;
    exchangeRateEffect: number;
    netChange: number;
    closingCash: number;
  };
  control: { ledgerClosingCash: number; difference: number; balanced: boolean };
};

function accountingDate(value: string, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) throw new Error("Dates must use YYYY-MM-DD");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+10:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString("en-CA", { timeZone: "Pacific/Port_Moresby" }) !== value) throw new Error("Invalid accounting date");
  return date;
}

function categoryFor(value: string | null): CashFlowCategory {
  const type = String(value || "JOURNAL").trim().toUpperCase();
  if (["FX_REVALUATION", "FX_REVALUATION_REVERSAL"].includes(type)) return "Exchange Rate Effect";
  if (["ASSET_PURCHASE", "ASSET_DISPOSAL", "FIXED_ASSET_PURCHASE", "FIXED_ASSET_DISPOSAL"].includes(type)) return "Investing";
  if (["FUNDING_LOAN", "LOAN_REPAYMENT", "OWNER_CONTRIBUTION", "OWNER_DRAWING", "EQUITY", "DIVIDEND"].includes(type)) return "Financing";
  return "Operating";
}

function pngDateText(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export async function buildCashFlowStatement(input: { from: string; asOf: string }, client: PrismaClient = prisma): Promise<CashFlowStatement> {
  const fromDate = accountingDate(input.from);
  const asOfDate = accountingDate(input.asOf, true);
  if (fromDate > asOfDate) throw new Error("from must be on or before asOf");

  const [accounts, mappedBanks, currencySettings] = await Promise.all([
    client.chartOfAccounts.findMany({ select: { id: true, code: true, name: true, parentId: true } }),
    client.bankAccount.findMany({ where: { isActive: true, chartOfAccountsId: { not: null } }, select: { chartOfAccountsId: true } }),
    client.globalSettings.findMany({
      where: {
        key: {
          in: [
            "currency",
            "base_currency",
            "default_cash_account",
            "default_bank_account",
          ],
        },
      },
      select: { key: true, value: true },
    }),
  ]);
  const baseCurrency = String(
    currencySettings.find((row) => row.key === "currency")?.value
    || currencySettings.find((row) => row.key === "base_currency")?.value
    || "PGK",
  ).trim().toUpperCase() || "PGK";
  const configuredCashCodes = [
    currencySettings.find((row) => row.key === "default_cash_account")?.value,
    currencySettings.find((row) => row.key === "default_bank_account")?.value,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => value.toUpperCase().startsWith("ACC-") ? value.slice(4) : value);
  const configuredCashIds = accounts
    .filter((account) => configuredCashCodes.includes(account.code))
    .map((account) => account.id);

  const children = new Map<string, string[]>();
  for (const account of accounts) if (account.parentId) children.set(account.parentId, [...(children.get(account.parentId) || []), account.id]);
  const cashIds = new Set(accounts.filter((account) => /^(111|112)/.test(account.code)).map((account) => account.id));
  for (const bank of mappedBanks) if (bank.chartOfAccountsId) cashIds.add(bank.chartOfAccountsId);
  for (const accountId of configuredCashIds) cashIds.add(accountId);
  const queue = [...cashIds];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of children.get(queue[index]) || []) if (!cashIds.has(child)) { cashIds.add(child); queue.push(child); }
  }
  if (!cashIds.size) throw new Error("No cash or bank GL accounts are configured");

  const lines = await client.journalLine.findMany({
    where: { accountId: { in: [...cashIds] }, journal: { status: "POSTED", date: { lte: asOfDate } } },
    select: {
      debit: true,
      credit: true,
      journal: { select: { id: true, code: true, date: true, sourceDocType: true, reference: true, description: true } },
    },
    orderBy: [{ journal: { date: "asc" } }, { journalId: "asc" }, { lineNo: "asc" }],
  });

  let openingCash = 0;
  const movements = new Map<string, CashFlowRow>();
  for (const line of lines) {
    const movement = Number(line.debit || 0) - Number(line.credit || 0);
    const sourceType = String(line.journal.sourceDocType || "").toUpperCase();
    const openingEntry = line.journal.date < fromDate || (sourceType === "OPENING" && line.journal.date <= fromDate);
    if (openingEntry) {
      openingCash += movement;
      continue;
    }
    const current = movements.get(line.journal.id) || {
      journalId: line.journal.id,
      journalCode: line.journal.code,
      date: pngDateText(line.journal.date),
      category: categoryFor(line.journal.sourceDocType),
      documentType: line.journal.sourceDocType || "JOURNAL",
      reference: line.journal.reference || "",
      description: line.journal.description,
      movement: 0,
    };
    current.movement = round(current.movement + movement);
    movements.set(line.journal.id, current);
  }
  const rows = [...movements.values()].filter((row) => Math.abs(row.movement) >= 0.005).sort((a, b) => a.date.localeCompare(b.date) || a.journalCode.localeCompare(b.journalCode));
  const categoryTotal = (category: CashFlowCategory) => round(rows.filter((row) => row.category === category).reduce((sum, row) => sum + row.movement, 0));
  const operating = categoryTotal("Operating");
  const investing = categoryTotal("Investing");
  const financing = categoryTotal("Financing");
  const exchangeRateEffect = categoryTotal("Exchange Rate Effect");
  const netCashFlow = round(operating + investing + financing);
  const netChange = round(netCashFlow + exchangeRateEffect);
  openingCash = round(openingCash);
  const closingCash = round(openingCash + netChange);
  const ledgerClosingCash = round(lines.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0));
  const difference = round(closingCash - ledgerClosingCash);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return {
    currency: baseCurrency,
    period: input,
    generatedAt: new Date().toISOString(),
    rows,
    cashAccounts: [...cashIds].map((id) => accountById.get(id)).filter((account): account is NonNullable<typeof account> => Boolean(account)).sort((a, b) => a.code.localeCompare(b.code)).map(({ code, name }) => ({ code, name })),
    totals: {
      openingCash,
      operating,
      investing,
      financing,
      netCashFlow,
      exchangeRateEffect,
      netChange,
      closingCash,
    },
    control: { ledgerClosingCash, difference, balanced: Math.abs(difference) < 0.01 },
  };
}
