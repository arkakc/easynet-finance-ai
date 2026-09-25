import { Prisma, PrismaClient } from "@prisma/client";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { clearUnlinkedBankLedgerMarker, markUnlinkedBankLedgerDescription } from "@/lib/accounting/bank-ledger-status";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type BankAccountInput = {
  id?: string;
  displayName?: string;
  bankName: string;
  accountNumber: string;
  bsb?: string;
  currency?: string;
  linkedAccountCode?: string;
  isActive?: boolean;
};

export function normalizePublicAccountCode(value: string) {
  return String(value || "").split("—")[0].trim().replace(/^ACC-/i, "");
}

function publicAccountId(code: string) {
  return `ACC-${code}`;
}

function maskedAccountNo(value: string) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (clean.length <= 4) return clean;
  return `${"•".repeat(Math.min(6, clean.length - 4))}${clean.slice(-4)}`;
}

async function bankParentAccount(client: DbClient) {
  const existing = await client.chartOfAccounts.findUnique({ where: { code: "1120" } });
  if (existing) return existing;
  const currentAssets = await client.chartOfAccounts.findUnique({ where: { code: "1100" } });
  return client.chartOfAccounts.create({
    data: {
      code: "1120",
      name: "Bank Accounts",
      type: "ASSET",
      parentId: currentAssets?.id || null,
      isActive: true,
      normalBalance: "DEBIT",
      description: "Physical operating bank accounts linked from company banking settings",
    },
  });
}

async function nextBankLedgerCode(client: DbClient) {
  const rows = await client.chartOfAccounts.findMany({
    where: { code: { startsWith: "112" } },
    select: { code: true },
  });
  const used = new Set(rows.map((row) => row.code));
  for (let code = 1121; code <= 1199; code += 1) {
    const next = String(code);
    if (!used.has(next)) return next;
  }
  throw new Error("No free bank ledger code is available in the 1121-1199 range");
}

async function validateLinkedBankLedger(client: DbClient, publicCodeOrId: string) {
  const code = normalizePublicAccountCode(publicCodeOrId);
  const account = await client.chartOfAccounts.findUnique({
    where: { code },
    include: { children: { select: { id: true } } },
  });
  if (!account || !account.isActive) throw new Error(`Linked bank GL account ${publicCodeOrId} was not found or is inactive`);
  if (account.type !== "ASSET") throw new Error(`Linked bank GL account ${account.code} must be an ASSET account`);
  if (account.children.length > 0) throw new Error(`Linked bank GL account ${account.code} is a group account; select a ledger account`);
  return account;
}

async function defaultBankLedger(client: DbClient, skipBankAccountId?: string) {
  const setting = await client.globalSettings.findFirst({ where: { key: "default_bank_account" }, select: { value: true } });
  const code = normalizePublicAccountCode(setting?.value || "");
  if (!code) return null;
  const account = await client.chartOfAccounts.findUnique({
    where: { code },
    include: { children: { select: { id: true } } },
  });
  if (!account || !account.isActive || account.type !== "ASSET" || account.children.length > 0) return null;
  const alreadyLinked = await client.bankAccount.findFirst({
    where: {
      chartOfAccountsId: account.id,
      isActive: true,
      ...(skipBankAccountId ? { NOT: { id: skipBankAccountId } } : {}),
    },
    select: { id: true },
  });
  return alreadyLinked ? null : account;
}

async function createBankLedger(client: DbClient, input: BankAccountInput) {
  const parent = await bankParentAccount(client);
  const code = await nextBankLedgerCode(client);
  const suffix = maskedAccountNo(input.accountNumber);
  const name = input.displayName?.trim() || `${input.bankName.trim()} Operating Account${suffix ? ` ${suffix}` : ""}`;
  return client.chartOfAccounts.create({
    data: {
      code,
      name,
      type: "ASSET",
      parentId: parent.id,
      isActive: true,
      currency: input.currency?.trim() || "PGK",
      normalBalance: "DEBIT",
      description: "Auto-created bank ledger linked to a physical company bank account",
    },
  });
}

export async function resolveBankLedger(client: DbClient, input: BankAccountInput) {
  const explicit = normalizePublicAccountCode(input.linkedAccountCode || "");
  if (explicit) return validateLinkedBankLedger(client, explicit);
  const defaultLedger = await defaultBankLedger(client, input.id);
  if (defaultLedger) return defaultLedger;
  return createBankLedger(client, input);
}

export async function upsertCompanyBankAccounts(client: DbClient, inputs: BankAccountInput[], actorEmail: string) {
  const activeInputs = inputs.filter((input) => input.isActive !== false);
  if (!activeInputs.length) throw new Error("At least one company bank account is mandatory after setup activation.");

  const existingActiveBanks = await client.bankAccount.findMany({
    where: { isActive: true },
    include: {
      chartOfAccounts: {
        include: {
          journalLines: {
            where: { journal: { status: "POSTED" } },
            select: { id: true },
          },
        },
      },
      _count: { select: { transactions: true, reconciliations: true } },
    },
  });
  const retainedExistingIds = new Set(activeInputs.map((input) => input.id).filter((id): id is string => Boolean(id)));
  const banksRequestedForRemoval = existingActiveBanks.filter((row) => !retainedExistingIds.has(row.id));

  for (const row of banksRequestedForRemoval) {
    const postedJournalCount = row.chartOfAccounts?.journalLines.length || 0;
    const transactionCount = row._count.transactions;
    const reconciliationCount = row._count.reconciliations;
    if (postedJournalCount > 0 || transactionCount > 0 || reconciliationCount > 0) {
      throw new Error(
        `Cannot remove bank account ${row.code} — ${row.name}: historical activity exists (${postedJournalCount} posted GL line(s), ${transactionCount} bank transaction(s), ${reconciliationCount} reconciliation(s)). Keep this bank master for audit history and add a new bank account instead.`,
      );
    }
  }

  const cleanInputs = activeInputs.map((input, index) => ({
    ...input,
    bankName: input.bankName.trim(),
    accountNumber: input.accountNumber.trim(),
    bsb: input.bsb?.trim() || "",
    currency: input.currency?.trim() || "PGK",
    displayName: input.displayName?.trim() || "",
    rowNo: index + 1,
  }));
  const invalid = cleanInputs.find((input) => !input.bankName || !input.accountNumber);
  if (invalid) throw new Error(`Bank account row ${invalid.rowNo} requires Bank Name and Bank Account Number.`);

  const saved = [];
  for (const input of cleanInputs) {
    const ledger = await resolveBankLedger(client, input);
    const duplicateActiveLink = await client.bankAccount.findFirst({
      where: {
        chartOfAccountsId: ledger.id,
        isActive: true,
        ...(input.id ? { NOT: { id: input.id } } : {}),
      },
      select: { code: true, name: true },
    });
    if (duplicateActiveLink) {
      throw new Error(
        `Bank GL account ${ledger.code} is already linked to active bank account ${duplicateActiveLink.code} — ${duplicateActiveLink.name}. Use a separate bank ledger for each physical bank account to preserve reconciliation integrity.`,
      );
    }
    const name = input.displayName || `${input.bankName} ${maskedAccountNo(input.accountNumber)}`.trim();
    const data = {
      name,
      bankName: input.bankName,
      bankCode: input.bsb || null,
      accountNumber: input.accountNumber,
      accountType: "CHECKING" as const,
      currency: input.currency || "PGK",
      isActive: true,
      chartOfAccountsId: ledger.id,
      notes: `Linked to GL ${ledger.code} by ${actorEmail}`,
    };
    const row = input.id
      ? await client.bankAccount.update({ where: { id: input.id }, data, include: { chartOfAccounts: true } })
      : await client.bankAccount.create({ data: { ...data, code: documentSeriesId("Bank Account") }, include: { chartOfAccounts: true } });
    if (String(ledger.description || "").includes("[UNLINKED_BANK_LEDGER]")) {
      await client.chartOfAccounts.update({
        where: { id: ledger.id },
        data: { description: clearUnlinkedBankLedgerMarker(ledger.description) || null },
      });
    }
    saved.push(row);
  }

  const savedIds = new Set(saved.map((row) => row.id));
  for (const row of banksRequestedForRemoval) {
    if (savedIds.has(row.id)) continue;
    if (row.chartOfAccounts?.id) {
      await client.chartOfAccounts.update({
        where: { id: row.chartOfAccounts.id },
        data: { description: markUnlinkedBankLedgerDescription(row.chartOfAccounts.description) },
      });
    }
    await client.bankAccount.update({
      where: { id: row.id },
      data: {
        isActive: false,
        chartOfAccountsId: null,
        notes: `${row.notes || ""}${row.notes ? " | " : ""}Removed from active company banking settings by ${actorEmail}; no historical activity existed at removal.`,
      },
    });
  }

  const first = saved[0];
  if (first) {
    await Promise.all([
      client.globalSettings.upsert({
        where: { key: "company_bank_name" },
        create: { key: "company_bank_name", value: first.bankName, description: "Primary operating corporate bank", updatedBy: actorEmail },
        update: { value: first.bankName, description: "Primary operating corporate bank", updatedBy: actorEmail, updatedAt: new Date() },
      }),
      client.globalSettings.upsert({
        where: { key: "company_bank_account" },
        create: { key: "company_bank_account", value: first.accountNumber || "", description: "Primary bank account number", updatedBy: actorEmail },
        update: { value: first.accountNumber || "", description: "Primary bank account number", updatedBy: actorEmail, updatedAt: new Date() },
      }),
      client.globalSettings.upsert({
        where: { key: "company_bank_bsb" },
        create: { key: "company_bank_bsb", value: first.bankCode || "", description: "Primary branch BSB code", updatedBy: actorEmail },
        update: { value: first.bankCode || "", description: "Primary branch BSB code", updatedBy: actorEmail, updatedAt: new Date() },
      }),
      client.globalSettings.upsert({
        where: { key: "company_bank_accounts" },
        create: { key: "company_bank_accounts", value: JSON.stringify(saved.map(toPublicBankAccount)), description: "Active company bank accounts", updatedBy: actorEmail },
        update: { value: JSON.stringify(saved.map(toPublicBankAccount)), description: "Active company bank accounts", updatedBy: actorEmail, updatedAt: new Date() },
      }),
    ]);
  }

  return saved.map(toPublicBankAccount);
}

export function toPublicBankAccount(row: any) {
  return {
    id: row.id,
    code: row.code,
    displayName: row.name,
    bankName: row.bankName,
    accountNumber: row.accountNumber || "",
    bsb: row.bankCode || "",
    currency: row.currency || "PGK",
    isActive: row.isActive !== false,
    linkedAccountId: row.chartOfAccountsId || "",
    linkedAccountCode: row.chartOfAccounts?.code ? publicAccountId(row.chartOfAccounts.code) : "",
    linkedAccountName: row.chartOfAccounts?.name || "",
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    notes: row.notes || "",
    transactionCount: Number(row._count?.transactions || 0),
    reconciliationCount: Number(row._count?.reconciliations || 0),
    postedJournalCount: Number(row.chartOfAccounts?.journalLines?.length || 0),
    hasHistory: Boolean(
      Number(row._count?.transactions || 0)
      || Number(row._count?.reconciliations || 0)
      || Number(row.chartOfAccounts?.journalLines?.length || 0)
    ),
  };
}
