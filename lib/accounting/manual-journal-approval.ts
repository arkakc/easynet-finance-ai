import { AccountTypeGL, Prisma, PrismaClient } from "@prisma/client";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { appendAuditEvent } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

export type ManualJournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
};

export type PendingManualJournalInput = {
  entryType: string;
  journalType: string;
  postingDate: string;
  reference: string;
  remarks?: string;
  lines: ManualJournalLineInput[];
  makerEmail: string;
  manualId?: string;
  journalId?: string;
};

type DecisionInput = {
  journalId: string;
  checkerEmail: string;
  note?: string;
  allowSelfApproval?: boolean;
};

const round2 = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function accountingDate(value: string) {
  const normalized = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("Posting date must use YYYY-MM-DD");
  }
  const date = new Date(`${normalized}T00:00:00+10:00`);
  if (Number.isNaN(date.getTime())) throw new Error("A valid posting date is required");
  return { normalized, date };
}

function accountCode(ref: string) {
  return String(ref || "").trim().replace(/^ACC-/i, "");
}

function isProfitAndLoss(type: AccountTypeGL) {
  return type === AccountTypeGL.REVENUE || type === AccountTypeGL.EXPENSE;
}

function validateBalanced(lines: ManualJournalLineInput[]) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("A manual journal requires at least two lines");
  }

  let debit = 0;
  let credit = 0;
  const accountSides = new Map<string, { debit: boolean; credit: boolean }>();
  for (const [index, line] of lines.entries()) {
    const d = Number(line.debit || 0);
    const c = Number(line.credit || 0);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) {
      throw new Error(`Invalid amount on journal line ${index + 1}`);
    }
    if (d > 0 && c > 0) {
      throw new Error(`Journal line ${index + 1} cannot contain both debit and credit`);
    }
    if (d === 0 && c === 0) {
      throw new Error(`Journal line ${index + 1} requires a debit or credit`);
    }
    const accountRef = String(line.accountId || "").trim();
    if (accountRef) {
      const sides = accountSides.get(accountRef) || { debit: false, credit: false };
      if (d > 0) sides.debit = true;
      if (c > 0) sides.credit = true;
      accountSides.set(accountRef, sides);
    }
    debit += d;
    credit += c;
  }

  const selfCancellingAccounts = [...accountSides.entries()]
    .filter(([, sides]) => sides.debit && sides.credit)
    .map(([accountRef]) => accountRef);
  if (selfCancellingAccounts.length) {
    throw new Error(`The same account cannot be used on both debit and credit sides of a manual journal: ${selfCancellingAccounts.join(", ")}`);
  }

  const totalDebit = round2(debit);
  const totalCredit = round2(credit);
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Journal is not balanced: debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}`,
    );
  }
  if (totalDebit <= 0) throw new Error("Manual journal total must be greater than zero");
  return { totalDebit, totalCredit };
}

async function assertPostingLock(
  tx: Prisma.TransactionClient,
  postingDate: string,
) {
  const lock = await tx.globalSettings.findUnique({
    where: { key: "posting_lock_date" },
    select: { value: true },
  });
  const lockDate = String(lock?.value || "").trim();
  if (
    lockDate
    && /^\d{4}-\d{2}-\d{2}$/.test(lockDate)
    && postingDate <= lockDate
  ) {
    throw new Error(
      `Financial period is locked through ${lockDate}. Ask an authorised user to reopen the period.`,
    );
  }
}

async function activeUser(tx: Prisma.TransactionClient, email: string, label: string) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error(`${label} identity is required`);
  const user = await tx.user.findUnique({ where: { email: normalized } });
  if (!user || user.status !== "ACTIVE") {
    throw new Error(`${label} user is not active`);
  }
  return user;
}

async function normalizeLines(
  tx: Prisma.TransactionClient,
  input: {
    postingDate: string;
    reference: string;
    lines: ManualJournalLineInput[];
  },
) {
  const totals = validateBalanced(input.lines);
  await assertPostingLock(tx, input.postingDate);

  const requestedCodes = [...new Set(input.lines.map((line) => accountCode(line.accountId)))];
  if (requestedCodes.some((code) => !code)) {
    throw new Error("Every manual journal line requires an account");
  }

  const accounts = await tx.chartOfAccounts.findMany({
    where: { code: { in: requestedCodes } },
    include: { children: { select: { id: true } } },
  });
  const byCode = new Map(accounts.map((account) => [account.code, account]));

  const missing = requestedCodes.filter((code) => !byCode.has(code));
  if (missing.length) {
    throw new Error(`Cannot submit manual journal: missing accounts ${missing.join(", ")}`);
  }

  const inactive = accounts.filter((account) => !account.isActive).map((account) => account.code);
  if (inactive.length) {
    throw new Error(`Cannot submit manual journal: inactive accounts ${inactive.join(", ")}`);
  }

  const groups = accounts
    .filter((account) => account.children.length > 0)
    .map((account) => account.code);
  if (groups.length) {
    throw new Error(
      `Cannot submit manual journal directly to group/control accounts: ${groups.join(", ")}`,
    );
  }

  const settings = await tx.globalSettings.findMany({
    where: { key: { in: ["default_cost_center", "round_off_cost_center", "currency", "base_currency"] } },
    select: { key: true, value: true },
  });
  const setting = new Map(settings.map((row) => [row.key, String(row.value || "")]));
  const defaultCostCenter = setting.get("default_cost_center") || "Main";
  const roundOffCostCenter = setting.get("round_off_cost_center") || defaultCostCenter;
  const baseCurrency = String(setting.get("currency") || setting.get("base_currency") || "PGK").trim().toUpperCase();

  const lines = input.lines.map((line, index) => {
    const code = accountCode(line.accountId);
    const account = byCode.get(code)!;
    const description = String(line.description || input.reference || "Manual journal").trim();
    const costCenter = isProfitAndLoss(account.type)
      ? (description.toLowerCase().includes("round") ? roundOffCostCenter : defaultCostCenter)
      : null;
    const debit = round2(Number(line.debit || 0));
    const credit = round2(Number(line.credit || 0));

    return {
      lineNo: index + 1,
      accountId: account.id,
      description,
      debit,
      credit,
      amount: Math.max(debit, credit),
      currency: baseCurrency,
      transactionCurrency: baseCurrency,
      exchangeRate: 1,
      transactionDebit: debit,
      transactionCredit: credit,
      transactionAmount: Math.max(debit, credit),
      costCenter,
    };
  });

  return { ...totals, baseCurrency, lines };
}

type PersistedPendingJournal = {
  id: string;
  code: string;
  date: Date;
  status: string;
  sourceDocType: string | null;
  sourceDocId: string | null;
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
  createdBy: string;
  lines: Array<{
    id: string;
    lineNo: number;
    accountId: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    description: string;
  }>;
};

async function validatePersistedPendingJournal(
  tx: Prisma.TransactionClient,
  journal: PersistedPendingJournal,
) {
  if (!journal || !journal.lines) throw new Error("Manual journal not found");
  const postingDate = normalizeAccountingDate(journal.date.toISOString());
  await assertPostingLock(tx, postingDate);

  const lineInputs: ManualJournalLineInput[] = journal.lines.map((line) => ({
    accountId: line.accountId,
    debit: Number(line.debit),
    credit: Number(line.credit),
    description: line.description,
  }));
  const totals = validateBalanced(lineInputs);

  if (
    totals.totalDebit !== round2(Number(journal.totalDebit))
    || totals.totalCredit !== round2(Number(journal.totalCredit))
  ) {
    throw new Error("Pending manual journal totals changed; approval is blocked for review");
  }

  const accountIds = [...new Set(journal.lines.map((line) => line.accountId))];
  const accounts = await tx.chartOfAccounts.findMany({
    where: { id: { in: accountIds } },
    include: { children: { select: { id: true } } },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error("Pending manual journal contains a missing account");
  }
  const inactive = accounts.filter((account) => !account.isActive).map((account) => account.code);
  if (inactive.length) {
    throw new Error(`Cannot approve manual journal: inactive accounts ${inactive.join(", ")}`);
  }
  const groups = accounts.filter((account) => account.children.length > 0).map((account) => account.code);
  if (groups.length) {
    throw new Error(
      `Cannot approve manual journal posted to group/control accounts: ${groups.join(", ")}`,
    );
  }

  return totals;
}

export async function createPendingManualJournal(
  input: PendingManualJournalInput,
  client: PrismaClient | Prisma.TransactionClient = prisma,
) {
  const { normalized: postingDate, date } = accountingDate(input.postingDate);
  const entryType = String(input.entryType || "JOURNAL_ENTRY").trim().toUpperCase();
  const journalType = String(input.journalType || "GENERAL_JOURNAL").trim().toUpperCase();
  const reference = String(input.reference || "").trim();
  if (reference.length < 3) throw new Error("Reference is required");

  const create = async (tx: Prisma.TransactionClient) => {
    const maker = await activeUser(tx, input.makerEmail, "Maker");
    const normalized = await normalizeLines(tx, {
      postingDate,
      reference,
      lines: input.lines,
    });

    const manualId = String(input.manualId || "").trim() || documentSeriesId("Manual Journal");
    const journalCode = String(input.journalId || "").trim() || documentSeriesId("Journal");

    const existing = await tx.journalHeader.findFirst({
      where: {
        OR: [
          { code: journalCode },
          { sourceDocId: manualId },
        ],
      },
      select: { code: true },
    });
    if (existing) {
      throw new Error(`Manual journal already exists: ${existing.code}`);
    }

    const narrative = [
      journalType,
      reference,
      input.remarks ? `Remarks: ${String(input.remarks).trim()}` : "",
    ].filter(Boolean).join(" · ");

    const journal = await tx.journalHeader.create({
      data: {
        code: journalCode,
        date,
        description: narrative,
        reference,
        sourceDocType: `MANUAL_${entryType}`,
        sourceDocId: manualId,
        status: "PENDING",
        currency: normalized.baseCurrency,
        baseCurrency: normalized.baseCurrency,
        exchangeRate: 1,
        totalDebit: normalized.totalDebit,
        totalCredit: normalized.totalCredit,
        transactionTotalDebit: normalized.totalDebit,
        transactionTotalCredit: normalized.totalCredit,
        isBalanced: true,
        createdBy: maker.email,
        approvedBy: null,
        approvedAt: null,
        postedAt: null,
        lines: { create: normalized.lines },
      },
    });

    await appendAuditEvent({
      action: "SUBMIT_FOR_APPROVAL",
      entityType: "Journal",
      entityId: journal.id,
      entityCode: journal.code,
      description: `Manual journal ${manualId} submitted for checker approval`,
      actorEmail: maker.email,
      userId: maker.id,
      outcome: "SUCCESS",
      metadata: {
        manualId,
        postingDate,
        totalDebit: normalized.totalDebit,
        totalCredit: normalized.totalCredit,
      },
    }, tx);

    return {
      id: journal.id,
      journalId: journal.code,
      manualId,
      status: "PENDING" as const,
      postingDate,
      totalDebit: normalized.totalDebit,
      totalCredit: normalized.totalCredit,
      makerEmail: maker.email,
    };
  };

  return "$transaction" in client
    ? client.$transaction(create)
    : create(client);
}

export async function approvePendingManualJournal(
  input: DecisionInput,
  client: PrismaClient = prisma,
) {
  return client.$transaction(async (tx) => {
    const checker = await activeUser(tx, input.checkerEmail, "Checker");
    const journal = await tx.journalHeader.findFirst({
      where: { OR: [{ id: input.journalId }, { code: input.journalId }] },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!journal || !String(journal.sourceDocType || "").startsWith("MANUAL_")) {
      throw new Error("Pending manual journal not found");
    }
    if (journal.status !== "PENDING") {
      throw new Error(`Only PENDING manual journals can be approved. Current status: ${journal.status}`);
    }
    if (!input.allowSelfApproval && journal.createdBy.trim().toLowerCase() === checker.email.trim().toLowerCase()) {
      throw new Error("Maker-checker control: the creator cannot approve their own manual journal");
    }

    const totals = await validatePersistedPendingJournal(tx, journal);
    const now = new Date();
    const updated = await tx.journalHeader.update({
      where: { id: journal.id },
      data: {
        status: "POSTED",
        approvedBy: checker.email,
        approvedAt: now,
        postedAt: now,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
        isBalanced: true,
      },
    });

    await appendAuditEvent({
      action: "APPROVE_POST",
      entityType: "Journal",
      entityId: journal.id,
      entityCode: journal.code,
      description: [
        "Checker approved and posted manual journal",
        input.note ? `Note: ${String(input.note).trim()}` : "",
      ].filter(Boolean).join(" · "),
      actorEmail: checker.email,
      userId: checker.id,
      outcome: "SUCCESS",
      metadata: {
        makerEmail: journal.createdBy,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
      },
    }, tx);

    return {
      journalId: updated.code,
      status: "POSTED" as const,
      makerEmail: journal.createdBy,
      checkerEmail: checker.email,
      postedAt: updated.postedAt?.toISOString() || now.toISOString(),
    };
  });
}

export async function rejectPendingManualJournal(
  input: DecisionInput,
  client: PrismaClient = prisma,
) {
  const note = String(input.note || "").trim();
  if (note.length < 3) throw new Error("Rejection reason is required");

  return client.$transaction(async (tx) => {
    const checker = await activeUser(tx, input.checkerEmail, "Checker");
    const journal = await tx.journalHeader.findFirst({
      where: { OR: [{ id: input.journalId }, { code: input.journalId }] },
    });
    if (!journal || !String(journal.sourceDocType || "").startsWith("MANUAL_")) {
      throw new Error("Pending manual journal not found");
    }
    if (journal.status !== "PENDING") {
      throw new Error(`Only PENDING manual journals can be rejected. Current status: ${journal.status}`);
    }
    if (!input.allowSelfApproval && journal.createdBy.trim().toLowerCase() === checker.email.trim().toLowerCase()) {
      throw new Error("Maker-checker control: the creator cannot reject their own submitted manual journal");
    }

    const updated = await tx.journalHeader.update({
      where: { id: journal.id },
      data: { status: "CANCELLED" },
    });

    await appendAuditEvent({
      action: "REJECT",
      entityType: "Journal",
      entityId: journal.id,
      entityCode: journal.code,
      description: `Manual journal rejected · Reason: ${note}`,
      actorEmail: checker.email,
      userId: checker.id,
      outcome: "SUCCESS",
      metadata: { makerEmail: journal.createdBy, reason: note },
    }, tx);

    return {
      journalId: updated.code,
      status: "CANCELLED" as const,
      makerEmail: journal.createdBy,
      checkerEmail: checker.email,
      reason: note,
    };
  });
}
