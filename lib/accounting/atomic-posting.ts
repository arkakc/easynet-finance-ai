import { AccountTypeGL, Prisma, PrismaClient } from "@prisma/client";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { prisma } from "@/src/lib/prisma";
import { companyBaseCurrency, normalizeCurrency, requireExchangeRate, roundCurrency, roundExchangeRate } from "@/lib/accounting/currency";

export type AtomicPostingLine = {
  accountId: string;
  debit?: number;
  credit?: number;
  customerId?: string;
  supplierId?: string;
  projectId?: string;
  taxCode?: string;
  costCenter?: string;
  description?: string;
  transactionCurrency?: string;
  transactionDebit?: number;
  transactionCredit?: number;
  exchangeRate?: number;
};

export type AtomicPostingRequest = {
  journalId?: string;
  postingDate: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  reference?: string;
  projectId?: string;
  currency?: string;
  baseCurrency?: string;
  exchangeRate?: number;
  createdBy?: string;
  approvedBy?: string;
  lines: AtomicPostingLine[];
};

export type AtomicAccountingContext = {
  tx: Prisma.TransactionClient;
  postJournal: (request: AtomicPostingRequest) => Promise<AtomicPostedJournal>;
};

export type AtomicPostedJournal = {
  id: string;
  journalId: string;
  postingDate: string;
  totalDebit: number;
  totalCredit: number;
};

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function accountingDate(value: string) {
  const normalized = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error("A valid posting date is required");
  const date = new Date(`${normalized}T00:00:00+10:00`);
  if (Number.isNaN(date.getTime())) throw new Error("A valid posting date is required");
  return { normalized, date };
}

function assertBalanced(lines: AtomicPostingLine[]) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("A journal requires at least two lines");
  let debit = 0;
  let credit = 0;

  for (const [index, line] of lines.entries()) {
    const d = Number(line.debit || 0);
    const c = Number(line.credit || 0);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) {
      throw new Error(`Invalid amount on journal line ${index + 1}`);
    }
    if (d > 0 && c > 0) throw new Error(`Journal line ${index + 1} cannot contain both debit and credit`);
    if (d === 0 && c === 0) throw new Error(`Journal line ${index + 1} requires a debit or credit`);
    debit += d;
    credit += c;
  }

  const totalDebit = round2(debit);
  const totalCredit = round2(credit);
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal is not balanced: debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}`);
  }
  return { totalDebit, totalCredit };
}

function accountCode(ref: string) {
  return String(ref || "").trim().replace(/^ACC-/i, "");
}

function pnlAccount(type: AccountTypeGL) {
  return type === AccountTypeGL.REVENUE || type === AccountTypeGL.EXPENSE;
}

export async function postJournalInTransaction(
  tx: Prisma.TransactionClient,
  request: AtomicPostingRequest,
): Promise<AtomicPostedJournal> {
  const { normalized: postingDate, date } = accountingDate(request.postingDate);
  const { totalDebit, totalCredit } = assertBalanced(request.lines);

  const lock = await tx.globalSettings.findUnique({ where: { key: "posting_lock_date" } });
  const lockDate = String(lock?.value || "").trim();
  if (lockDate && /^\d{4}-\d{2}-\d{2}$/.test(lockDate) && postingDate <= lockDate) {
    throw new Error(
      `Financial period is locked through ${lockDate}. Post a reversal or ask an authorised user to reopen the period.`,
    );
  }

  const existing = await tx.journalHeader.findFirst({
    where: {
      OR: [
        { sourceDocId: request.documentId },
        { sourceDocType: request.documentType, sourceDocId: request.documentId },
      ],
    },
    select: { code: true },
  });
  if (existing) throw new Error(`This document already has a posted journal: ${existing.code}`);

  const requestedCodes = [...new Set(request.lines.map((line) => accountCode(line.accountId)))];
  if (requestedCodes.some((code) => !code)) throw new Error("Every journal line requires an account");

  const accounts = await tx.chartOfAccounts.findMany({
    where: { code: { in: requestedCodes } },
    include: { children: { select: { id: true } } },
  });
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const missing = requestedCodes.filter((code) => !byCode.has(code));
  if (missing.length) throw new Error(`Cannot post journal: missing accounts ${missing.join(", ")}`);

  const inactive = accounts.filter((account) => !account.isActive).map((account) => account.code);
  if (inactive.length) throw new Error(`Cannot post journal: inactive accounts ${inactive.join(", ")}`);

  const groups = accounts.filter((account) => account.children.length > 0).map((account) => account.code);
  if (groups.length) throw new Error(`Cannot post journal directly to group/control accounts: ${groups.join(", ")}`);

  const baseCurrency = normalizeCurrency(request.baseCurrency || await companyBaseCurrency(tx));
  const sourceCurrency = normalizeCurrency(request.currency || baseCurrency);
  const sourceExchangeRate = sourceCurrency === baseCurrency
    ? 1
    : requireExchangeRate(sourceCurrency, baseCurrency, request.exchangeRate);

  const settings = await tx.globalSettings.findMany({
    where: { key: { in: ["default_cost_center", "round_off_cost_center"] } },
    select: { key: true, value: true },
  });
  const setting = new Map(settings.map((row) => [row.key, String(row.value || "")]));
  const defaultCostCenter = setting.get("default_cost_center") || "Main";
  const roundOffCostCenter = setting.get("round_off_cost_center") || defaultCostCenter;

  const normalizedLines = request.lines.map((line, index) => {
    const code = accountCode(line.accountId);
    const account = byCode.get(code)!;
    const description = String(line.description || request.reference || request.documentNumber || "Journal entry");
    const explicitCostCenter = String(line.costCenter || "").trim();
    const costCenter = explicitCostCenter || (
      pnlAccount(account.type)
        ? (description.toLowerCase().includes("round") ? roundOffCostCenter : defaultCostCenter)
        : null
    );

    const debit = roundCurrency(Number(line.debit || 0));
    const credit = roundCurrency(Number(line.credit || 0));
    const transactionCurrency = normalizeCurrency(line.transactionCurrency || sourceCurrency);
    const lineExchangeRate = transactionCurrency === baseCurrency
      ? 1
      : requireExchangeRate(
          transactionCurrency,
          baseCurrency,
          line.exchangeRate ?? (transactionCurrency === sourceCurrency ? sourceExchangeRate : undefined),
        );
    const transactionDebit = line.transactionDebit !== undefined
      ? roundCurrency(Number(line.transactionDebit || 0))
      : roundCurrency(debit / lineExchangeRate);
    const transactionCredit = line.transactionCredit !== undefined
      ? roundCurrency(Number(line.transactionCredit || 0))
      : roundCurrency(credit / lineExchangeRate);

    return {
      lineNo: index + 1,
      accountId: account.id,
      description,
      debit,
      credit,
      amount: Math.max(debit, credit),
      currency: baseCurrency,
      transactionCurrency,
      exchangeRate: roundExchangeRate(lineExchangeRate),
      transactionDebit,
      transactionCredit,
      transactionAmount: Math.max(transactionDebit, transactionCredit),
      projectId: String(line.projectId || request.projectId || "").trim() || null,
      customerId: String(line.customerId || "").trim() || null,
      supplierId: String(line.supplierId || "").trim() || null,
      taxCode: String(line.taxCode || "").trim() || null,
      costCenter,
    };
  });

  const transactionTotals = new Map<string, { debit: number; credit: number }>();
  for (const line of normalizedLines) {
    const current = transactionTotals.get(line.transactionCurrency) || { debit: 0, credit: 0 };
    current.debit = roundCurrency(current.debit + Number(line.transactionDebit || 0));
    current.credit = roundCurrency(current.credit + Number(line.transactionCredit || 0));
    transactionTotals.set(line.transactionCurrency, current);
  }
  for (const [currency, totals] of transactionTotals.entries()) {
    if (totals.debit !== totals.credit) {
      throw new Error(
        `Transaction-currency journal is not balanced for ${currency}: debit ${totals.debit.toFixed(2)} vs credit ${totals.credit.toFixed(2)}`,
      );
    }
  }

  const sourceTransactionTotals = transactionTotals.get(sourceCurrency) || { debit: 0, credit: 0 };

  const journalCode = String(request.journalId || "").trim() || documentSeriesId("Journal");
  const createdBy = request.createdBy || "finance-ui";
  const approvedBy = request.approvedBy || "Finance Controller";

  const journal = await tx.journalHeader.create({
    data: {
      code: journalCode,
      date,
      description: request.reference || request.documentNumber || request.documentType,
      reference: request.documentNumber || null,
      sourceDocType: request.documentType,
      sourceDocId: request.documentId,
      status: "POSTED",
      currency: sourceCurrency,
      baseCurrency,
      exchangeRate: roundExchangeRate(sourceExchangeRate),
      totalDebit,
      totalCredit,
      transactionTotalDebit: sourceTransactionTotals.debit,
      transactionTotalCredit: sourceTransactionTotals.credit,
      isBalanced: true,
      createdBy,
      approvedBy,
      approvedAt: new Date(),
      postedAt: new Date(),
      lines: { create: normalizedLines },
    },
  });

  const user = await tx.user.findUnique({ where: { email: createdBy } });
  if (user) {
    await tx.auditLog.create({
      data: {
        action: "POST",
        entityType: "Journal",
        entityId: journal.id,
        entityCode: journal.code,
        description: `Posted ${request.documentType} ${request.documentId}`,
        userId: user.id,
      },
    });
  }

  return {
    id: journal.id,
    journalId: journal.code,
    postingDate,
    totalDebit,
    totalCredit,
  };
}

export async function runAtomicAccounting<T>(
  work: (context: AtomicAccountingContext) => Promise<T>,
  client: PrismaClient = prisma,
) {
  return client.$transaction(
    async (tx) => work({
      tx,
      postJournal: (request) => postJournalInTransaction(tx, request),
    }),
    {
      maxWait: 5_000,
      timeout: 20_000,
    },
  );
}
