const marker = "[core05-verify]";
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";
const preview = process.env.VERCEL_ENV === "preview";

if (!preview || !commitMessage.includes(marker)) {
  console.log("[core05-verify] skipped", { preview, markerPresent: commitMessage.includes(marker) });
  process.exit(0);
}

const url = process.env.CORE_APPS_SCRIPT_WEB_APP_URL;
const token = process.env.CORE_APPS_SCRIPT_API_TOKEN;
if (!url || !token) throw new Error("Core backend is not fully configured in Preview environment");

async function call(action, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, action, payload }),
    redirect: "follow",
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Core returned non-JSON content (${response.status})`); }
  if (!response.ok) throw new Error(`Core HTTP ${response.status}`);
  if (!data || data.ok !== true) throw new Error(`Core: ${String(data?.error || "backend error")}`);
  return data;
}

const requiredAccounts = [
  { accountId: "ACC-2190", accountCode: "2190", accountName: "Stock Received But Not Billed / GRNI", accountType: "Liability", parentAccount: "ACC-2100", active: true },
  { accountId: "ACC-2191", accountCode: "2191", accountName: "Landed Cost Clearing", accountType: "Liability", parentAccount: "ACC-2100", active: true },
  { accountId: "ACC-4910", accountCode: "4910", accountName: "Inventory Adjustment / Revaluation Gain", accountType: "Income", parentAccount: "ACC-4000", active: true },
  { accountId: "ACC-5110", accountCode: "5110", accountName: "Purchase Price Variance", accountType: "Expense", parentAccount: "ACC-5000", active: true },
  { accountId: "ACC-5120", accountCode: "5120", accountName: "Inventory Adjustment / NRV Write-down", accountType: "Expense", parentAccount: "ACC-5000", active: true },
];

const requiredSettings = [
  { key: "perpetual_inventory", value: "true", notes: "Perpetual inventory GL integration enabled." },
  { key: "purchase_price_variance_tolerance_pct", value: "5", notes: "Supplier invoice stock price variance above this percentage is blocked for review." },
  { key: "deferred_revenue_policy_json", value: JSON.stringify({ "ACC-4700": 12, "ACC-4400": 12 }), notes: "Revenue account to monthly recognition-period mapping." },
  { key: "inventory_valuation_method", value: "MOVING_AVERAGE", notes: "Inventory valuation method used for perpetual inventory and COGS." },
  { key: "inventory_nrv_policy", value: "LOWER_OF_COST_AND_NRV", notes: "IAS 2 style lower-of-cost-and-NRV control." },
];

const criticalAccountIds = [
  "ACC-1110", "ACC-1120", "ACC-1130", "ACC-1140", "ACC-1150", "ACC-1160",
  "ACC-2110", "ACC-2120", "ACC-2130", "ACC-2140", "ACC-2150", "ACC-2190", "ACC-2191",
  "ACC-4910", "ACC-5110", "ACC-5120", "ACC-6100",
];

console.log("[core05-verify] starting live Core 0.5 verification");
const health = await call("health");
const bootstrap = await call("bootstrapStatus");
if (String(health.version || "") !== "0.5.0") throw new Error(`Expected Core 0.5.0, got ${String(health.version || "UNKNOWN")}`);
if (!bootstrap.ok) throw new Error(`Core bootstrap incomplete: ${JSON.stringify(bootstrap.missingSheets || [])}`);

let accounts = (await call("list", { table: "Accounts", limit: 500, offset: 0 })).rows || [];
const accountIdsBefore = new Set(accounts.map((row) => String(row.accountId || "")));
let accountsAdded = 0;
for (const account of requiredAccounts) {
  if (!accountIdsBefore.has(account.accountId)) {
    await call("append", { table: "Accounts", record: account, actor: "core05-verification-bootstrap" });
    accountsAdded += 1;
  }
}

let settings = (await call("list", { table: "Settings", limit: 500, offset: 0 })).rows || [];
const settingKeysBefore = new Set(settings.map((row) => String(row.key || "")));
let settingsAdded = 0;
for (const setting of requiredSettings) {
  if (!settingKeysBefore.has(setting.key)) {
    await call("append", { table: "Settings", record: { ...setting, updatedAt: new Date().toISOString() }, actor: "core05-verification-bootstrap" });
    settingsAdded += 1;
  }
}

accounts = (await call("list", { table: "Accounts", limit: 500, offset: 0 })).rows || [];
settings = (await call("list", { table: "Settings", limit: 500, offset: 0 })).rows || [];
const accountIds = new Set(accounts.map((row) => String(row.accountId || "")));
const parentIds = new Set(accounts.map((row) => String(row.parentAccount || "")).filter(Boolean));
const settingKeys = new Set(settings.map((row) => String(row.key || "")));
const missingCritical = criticalAccountIds.filter((id) => !accountIds.has(id));
const criticalParents = criticalAccountIds.filter((id) => parentIds.has(id));
const missingSettings = requiredSettings.map((row) => row.key).filter((key) => !settingKeys.has(key));

const items = await call("list", { table: "Items", limit: 1, offset: 0 });
const stockMovements = await call("list", { table: "StockMovements", limit: 1, offset: 0 });
const schedules = await call("list", { table: "PaymentSchedules", limit: 1, offset: 0 });

const ok = accounts.length >= 77 && missingCritical.length === 0 && criticalParents.length === 0 && missingSettings.length === 0;
const summary = {
  ok,
  version: health.version,
  bootstrapOk: bootstrap.ok,
  accountCount: accounts.length,
  expectedMinimumAccountCount: 77,
  accountsAdded,
  settingsAdded,
  missingCritical,
  criticalParents,
  missingSettings,
  tablesReadable: {
    Items: Array.isArray(items.rows),
    StockMovements: Array.isArray(stockMovements.rows),
    PaymentSchedules: Array.isArray(schedules.rows),
  },
};
console.log("[core05-verify] result", JSON.stringify(summary, null, 2));
if (!ok) throw new Error("Core 0.5 verification failed");
console.log("[core05-verify] PASS");
