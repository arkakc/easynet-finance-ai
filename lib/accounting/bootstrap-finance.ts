import {
  batchAppend,
  listTable,
} from "@/lib/backend/apps-script";
import {
  INITIAL_CHART_OF_ACCOUNTS,
} from "@/lib/accounting/chart-of-accounts";

async function loadExistingAccounts() {
  const accounts = await listTable<{ accountId: string }>("Accounts", 500, 0);
  return accounts.rows;
}

async function ensureAccounts(existingAccounts: { accountId: string }[]) {
  const existingIds = new Set(existingAccounts.map((row) => row.accountId));
  const missing = INITIAL_CHART_OF_ACCOUNTS.filter(
    (account) => !existingIds.has(account.accountId),
  );

  if (missing.length) {
    await batchAppend("Accounts", [...missing], "finance-bootstrap");
  }

  return missing.map((account) => account.accountId);
}

/**
 * Finance bootstrap is intentionally configuration-only.
 *
 * It verifies/seeds the Chart of Accounts but MUST NOT create opening balances,
 * loans, journals, customers, suppliers, items, projects or transactions.
 * Opening balances and financing are real accounting data and must be entered
 * explicitly through the normal controlled workflows after a fresh start.
 */
export async function bootstrapFinanceMasterData() {
  const existingAccounts = await loadExistingAccounts();
  const createdAccounts = await ensureAccounts(existingAccounts);

  return {
    ok: true,
    createdAccounts,
    chartOfAccountsCount: INITIAL_CHART_OF_ACCOUNTS.length,
    zeroDataSafe: true,
    openingBalancesCreated: false,
    openingLoansCreated: false,
    openingJournalsCreated: false,
    note: "Finance initialization only verifies the Chart of Accounts. No accounting or operational data is seeded.",
  };
}
