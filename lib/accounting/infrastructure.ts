import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";

const REQUIRED_ACCOUNTS = [
  { accountId: "ACC-2190", accountCode: "2190", accountName: "Stock Received But Not Billed / GRNI", accountType: "Liability", parentAccount: "ACC-2100", active: true },
  { accountId: "ACC-2191", accountCode: "2191", accountName: "Landed Cost Clearing", accountType: "Liability", parentAccount: "ACC-2100", active: true },
  { accountId: "ACC-4910", accountCode: "4910", accountName: "Inventory Adjustment / Revaluation Gain", accountType: "Income", parentAccount: "ACC-4000", active: true },
  { accountId: "ACC-5110", accountCode: "5110", accountName: "Purchase Price Variance", accountType: "Expense", parentAccount: "ACC-5000", active: true },
  { accountId: "ACC-5120", accountCode: "5120", accountName: "Inventory Adjustment / NRV Write-down", accountType: "Expense", parentAccount: "ACC-5000", active: true },
] as const;

const REQUIRED_SETTINGS = [
  { key: "perpetual_inventory", value: "true", notes: "Perpetual inventory GL integration enabled." },
  { key: "purchase_price_variance_tolerance_pct", value: "5", notes: "Supplier invoice stock price variance above this percentage is blocked for review." },
  { key: "deferred_revenue_policy_json", value: JSON.stringify({ "ACC-4700": 12, "ACC-4400": 12 }), notes: "Revenue account to monthly recognition-period mapping. Item Master deferred months can override its revenue-account policy." },
  { key: "inventory_valuation_method", value: "MOVING_AVERAGE", notes: "Inventory valuation method used for perpetual inventory and COGS." },
  { key: "inventory_nrv_policy", value: "LOWER_OF_COST_AND_NRV", notes: "IAS 2 style lower-of-cost-and-NRV control." },
] as const;

let ensurePromise: Promise<void> | null = null;

async function ensureOnce() {
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

  // Item Master may set a more specific period. The current accounting model
  // posts deferred revenue by revenue account, so items sharing one revenue
  // account must use the same custom period. This keeps posting deterministic
  // and avoids one invoice line silently using a different recognition policy.
  const items = await listTable<any>("Items", 500, 0);
  const itemPolicy = new Map<string, number>();
  for (const item of items.rows) {
    if (String(item.itemType || "").toUpperCase() === "STOCK") continue;
    const periods = Math.trunc(Number(item.deferredRevenueMonths || 0));
    if (!(periods > 1 && periods <= 120)) continue;
    const accountId = String(item.revenueAccount || "").trim();
    if (!accountId) continue;
    const existing = itemPolicy.get(accountId);
    if (existing && existing !== periods) {
      throw new Error(`Deferred revenue policy conflict on ${accountId}: Item Master contains both ${existing} and ${periods} month schedules. Use separate revenue accounts or one common period.`);
    }
    itemPolicy.set(accountId, periods);
  }
  for (const [accountId, periods] of itemPolicy.entries()) normalized[accountId] = periods;
  return normalized;
}
