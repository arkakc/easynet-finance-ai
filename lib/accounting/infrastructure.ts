import { appendRecord, findRecords, isBackendConfigured, listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";
import { INITIAL_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";

const REQUIRED_ACCOUNTS = [
  { accountId: "ACC-2190", accountCode: "2190", accountName: "Stock Received But Not Billed / GRNI", accountType: "Liability", parentAccount: "ACC-2100", active: true },
  { accountId: "ACC-2191", accountCode: "2191", accountName: "Landed Cost Clearing", accountType: "Liability", parentAccount: "ACC-2100", active: true },
  { accountId: "ACC-4910", accountCode: "4910", accountName: "Inventory Adjustment / Revaluation Gain", accountType: "Income", parentAccount: "ACC-4000", active: true },
  { accountId: "ACC-4920", accountCode: "4920", accountName: "Realized Foreign Exchange Gain", accountType: "Income", parentAccount: "ACC-4000", active: true },
  { accountId: "ACC-4930", accountCode: "4930", accountName: "Unrealized Foreign Exchange Gain", accountType: "Income", parentAccount: "ACC-4000", active: true },
  { accountId: "ACC-5110", accountCode: "5110", accountName: "Purchase Price Variance", accountType: "Expense", parentAccount: "ACC-5000", active: true },
  { accountId: "ACC-5120", accountCode: "5120", accountName: "Inventory Adjustment / NRV Write-down", accountType: "Expense", parentAccount: "ACC-5000", active: true },
  { accountId: "ACC-6995", accountCode: "6995", accountName: "Realized Foreign Exchange Loss", accountType: "Expense", parentAccount: "ACC-6000", active: true },
  { accountId: "ACC-6996", accountCode: "6996", accountName: "Unrealized Foreign Exchange Loss", accountType: "Expense", parentAccount: "ACC-6000", active: true },
] as const;

const REQUIRED_SETTINGS = [
  { key: "perpetual_inventory", value: "true", notes: "Perpetual inventory GL integration enabled." },
  { key: "purchase_price_variance_tolerance_pct", value: "5", notes: "Supplier invoice stock price variance above this percentage is blocked for review." },
  { key: "deferred_revenue_policy_json", value: JSON.stringify({ "ACC-4700": 12, "ACC-4400": 12 }), notes: "Revenue account to monthly recognition-period mapping. Item Master deferred months can override its revenue-account policy." },
  { key: "inventory_valuation_method", value: "MOVING_AVERAGE", notes: "Inventory valuation method used for perpetual inventory and COGS." },
  { key: "inventory_nrv_policy", value: "LOWER_OF_COST_AND_NRV", notes: "IAS 2 style lower-of-cost-and-NRV control." },
  { key: "currency", value: "PGK", notes: "Company base currency. General Ledger amounts are stored in this currency." },
  { key: "exchange_gain_account", value: "ACC-4920", notes: "Realized foreign exchange gain account." },
  { key: "exchange_loss_account", value: "ACC-6995", notes: "Realized foreign exchange loss account." },
  { key: "exchange_unrealized_gain_account", value: "ACC-4930", notes: "Period-end unrealized foreign exchange gain account." },
  { key: "exchange_unrealized_loss_account", value: "ACC-6996", notes: "Period-end unrealized foreign exchange loss account." },
] as const;

let ensurePromise: Promise<void> | null = null;

function prismaAccountType(accountType: string) {
  const types: Record<string, string> = {
    Asset: "ASSET",
    Liability: "LIABILITY",
    Equity: "EQUITY",
    Income: "REVENUE",
    Expense: "EXPENSE",
    "Contra Asset": "CONTRA_ASSET",
    "Contra Liability": "CONTRA_LIABILITY",
  };
  return types[accountType] || "ASSET";
}

function normalBalance(accountType: string) {
  return ["Liability", "Equity", "Income", "Contra Asset"].includes(accountType) ? "CREDIT" : "DEBIT";
}

async function reconcileLocalChartOfAccounts() {
  if (isBackendConfigured("core")) return;

  const canonicalCodes = new Set(INITIAL_CHART_OF_ACCOUNTS.map((account) => account.accountCode));
  for (const account of INITIAL_CHART_OF_ACCOUNTS) {
    const parentCode = account.parentAccount.replace(/^ACC-/, "") || null;
    await prisma.chartOfAccounts.upsert({
      where: { code: account.accountCode },
      update: {
        name: account.accountName,
        type: prismaAccountType(account.accountType) as any,
        normalBalance: normalBalance(account.accountType) as any,
        isActive: account.active,
        parent: parentCode ? { connect: { code: parentCode } } : { disconnect: true },
      },
      create: {
        code: account.accountCode,
        name: account.accountName,
        type: prismaAccountType(account.accountType) as any,
        normalBalance: normalBalance(account.accountType) as any,
        isActive: account.active,
        isSystem: true,
        currency: "PGK",
        ...(parentCode ? { parent: { connect: { code: parentCode } } } : {}),
      },
    });
  }

  const accounts = await prisma.chartOfAccounts.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(accounts.map((account) => [account.code, account.id]));
  const parentCodes = new Set(
    INITIAL_CHART_OF_ACCOUNTS.map((account) => account.parentAccount.replace(/^ACC-/, "")).filter(Boolean),
  );
  for (const account of INITIAL_CHART_OF_ACCOUNTS) {
    if (parentCodes.has(account.accountCode)) continue;
    const leafId = idByCode.get(account.accountCode);
    const replacementParentId = idByCode.get(account.parentAccount.replace(/^ACC-/, ""));
    if (!leafId || !replacementParentId) continue;
    await prisma.chartOfAccounts.updateMany({
      where: { parentId: leafId, code: { notIn: [...canonicalCodes] } },
      data: { parentId: replacementParentId },
    });
  }
}

async function ensureOnce() {
  await reconcileLocalChartOfAccounts();
  for (const account of REQUIRED_ACCOUNTS) {
    const found = await findRecords("Accounts", { accountId: account.accountId }, 1);
    if (!found.rows.length) await appendRecord("Accounts", account, "accounting-0.5-bootstrap");
  }

  for (const setting of REQUIRED_SETTINGS) {
    const found = await findRecords("Settings", { key: setting.key }, 1);
    if (!found.rows.length) await appendRecord("Settings", { ...setting, updatedAt: new Date().toISOString() }, "accounting-0.5-bootstrap");
  }
}

export async function ensureAccountingInfrastructure() {
  if (!ensurePromise) ensurePromise = ensureOnce().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  await ensurePromise;
}

export async function accountingSetting(key: string, fallback = "") {
  const found = await findRecords<{ key: string; value: string }>("Settings", { key }, 1);
  return String(found.rows[0]?.value ?? fallback);
}

export async function purchasePriceVarianceTolerancePct() {
  const value = Number(await accountingSetting("purchase_price_variance_tolerance_pct", "5"));
  return Number.isFinite(value) && value >= 0 ? value : 5;
}

export async function deferredRevenuePolicy() {
  const raw = await accountingSetting("deferred_revenue_policy_json", JSON.stringify({ "ACC-4700": 12, "ACC-4400": 12 }));
  let normalized: Record<string, number> = {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [accountId, periods] of Object.entries(parsed || {})) {
      const count = Math.trunc(Number(periods));
      if (accountId && count > 1 && count <= 120) normalized[accountId] = count;
    }
  } catch {
    normalized = { "ACC-4700": 12, "ACC-4400": 12 };
  }

  // Account policy is a legacy fallback only. Each new invoice line records
  // its own recognition period; unrelated items sharing an income account
  // must not conflict with one another.
  return normalized;
}
