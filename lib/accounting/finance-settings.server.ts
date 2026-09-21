import "server-only";

import { listTable } from "@/lib/backend/apps-script";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";

type SettingRow = { key?: string; value?: string };
type AccountRow = { accountId?: string; accountCode?: string; accountName?: string; active?: boolean | string; isGroup?: boolean; parentAccount?: string };

export type ConfiguredPostingAccounts = {
  defaultBankAccount: string;
  defaultCashAccount: string;
  defaultReceivableAccount: string;
  defaultPayableAccount: string;
  retainedEarningsAccount: string;
  roundOffAccount: string;
  exchangeGainLossAccount: string;
  exchangeGainAccount: string;
  exchangeLossAccount: string;
  exchangeUnrealizedGainAccount: string;
  exchangeUnrealizedLossAccount: string;
  defaultEmployeeAdvanceAccount: string;
  defaultCostOfGoodsSoldAccount: string;
  defaultIncomeAccount: string;
  defaultDeferredRevenueAccount: string;
  defaultDeferredExpenseAccount: string;
  defaultPayrollPayableAccount: string;
  defaultExpenseClaimPayableAccount: string;
  defaultPaymentDiscountAccount: string;
  writeOffAccount: string;
  unrealizedExchangeGainLossAccount: string;
  unrealizedProfitLossAccount: string;
  defaultInventoryAccount: string;
  stockAdjustmentAccount: string;
  stockReceivedButNotBilledAccount: string;
  serviceReceivedButNotBilledAccount: string;
  expensesIncludedInValuationAccount: string;
  accumulatedDepreciationAccount: string;
  depreciationExpenseAccount: string;
  gainLossAccountOnAssetDisposal: string;
  capitalWorkInProgressAccount: string;
  assetReceivedButNotBilledAccount: string;
  expensesIncludedInAssetValuationAccount: string;
};

const accountReference = (value: string) => {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return clean.toUpperCase().startsWith("ACC-") ? clean : `ACC-${clean}`;
};

const cleanAccountInput = (value: string) => String(value || "").split("—")[0].trim();

function resolveAccount(value: string, fallback: string, accounts: AccountRow[]) {
  const clean = cleanAccountInput(value);
  if (!clean) return fallback;
  const normalized = clean.toLowerCase();
  const matched = accounts.find((account) => {
    const label = `${account.accountCode || ""} — ${account.accountName || ""}`.toLowerCase();
    return [account.accountId, account.accountCode, account.accountName]
      .some((candidate) => String(candidate || "").toLowerCase() === normalized) || label === normalized;
  });
  if (matched?.accountId) return String(matched.accountId);
  if (matched?.accountCode) return accountReference(String(matched.accountCode));
  return accountReference(clean);
}

export async function loadConfiguredPostingAccounts(): Promise<ConfiguredPostingAccounts> {
  const [settingsResult, accountsResult] = await Promise.all([
    listTable<SettingRow>("Settings", 500, 0),
    listTable<AccountRow>("Accounts", 500, 0),
  ]);
  const settings = new Map(settingsResult.rows.map((row) => [String(row.key || ""), String(row.value || "")]));
  const activeLedgers = accountsResult.rows.filter((row) => {
    const active = String(row.active ?? "true").toLowerCase() !== "false";
    const isGroup = Boolean(row.isGroup || accountsResult.rows.some((candidate) => String(candidate.parentAccount || "") === String(row.accountId || "")));
    return active && !isGroup;
  });
  const resolve = (key: string, fallback: string) => resolveAccount(settings.get(key) || "", fallback, activeLedgers);

  return {
    defaultBankAccount: resolve("default_bank_account", INITIAL_ACCOUNT_IDS.bank),
    defaultCashAccount: resolve("default_cash_account", INITIAL_ACCOUNT_IDS.cash),
    defaultReceivableAccount: resolve("default_receivable_account", INITIAL_ACCOUNT_IDS.accountsReceivable),
    defaultPayableAccount: resolve("default_payable_account", INITIAL_ACCOUNT_IDS.accountsPayable),
    retainedEarningsAccount: resolve("retained_earnings_account", "ACC-3200"),
    roundOffAccount: resolve("round_off_account", "ACC-6990"),
    exchangeGainLossAccount: resolve("exchange_gain_loss_account", "ACC-6990"),
    exchangeGainAccount: resolve("exchange_gain_account", INITIAL_ACCOUNT_IDS.exchangeGain),
    exchangeLossAccount: resolve("exchange_loss_account", INITIAL_ACCOUNT_IDS.exchangeLoss),
    exchangeUnrealizedGainAccount: resolve("exchange_unrealized_gain_account", INITIAL_ACCOUNT_IDS.exchangeUnrealizedGain),
    exchangeUnrealizedLossAccount: resolve("exchange_unrealized_loss_account", INITIAL_ACCOUNT_IDS.exchangeUnrealizedLoss),
    defaultEmployeeAdvanceAccount: resolve("default_employee_advance_account", "ACC-1180"),
    defaultCostOfGoodsSoldAccount: resolve("default_cost_of_goods_sold_account", "ACC-5100"),
    defaultIncomeAccount: resolve("default_income_account", "ACC-4100"),
    defaultDeferredRevenueAccount: resolve("default_deferred_revenue_account", INITIAL_ACCOUNT_IDS.customerAdvances),
    defaultDeferredExpenseAccount: resolve("default_deferred_expense_account", "ACC-1170"),
    defaultPayrollPayableAccount: resolve("default_payroll_payable_account", "ACC-2170"),
    defaultExpenseClaimPayableAccount: resolve("default_expense_claim_payable_account", "ACC-2160"),
    defaultPaymentDiscountAccount: resolve("default_payment_discount_account", "ACC-6990"),
    writeOffAccount: resolve("write_off_account", "ACC-6980"),
    unrealizedExchangeGainLossAccount: resolve("unrealized_exchange_gain_loss_account", "ACC-6990"),
    unrealizedProfitLossAccount: resolve("unrealized_profit_loss_account", "ACC-6990"),
    defaultInventoryAccount: resolve("default_inventory_account", INITIAL_ACCOUNT_IDS.inventory),
    stockAdjustmentAccount: resolve("stock_adjustment_account", INITIAL_ACCOUNT_IDS.inventoryAdjustmentLoss),
    stockReceivedButNotBilledAccount: resolve("stock_received_but_not_billed_account", INITIAL_ACCOUNT_IDS.grni),
    serviceReceivedButNotBilledAccount: resolve("service_received_but_not_billed_account", "ACC-2160"),
    expensesIncludedInValuationAccount: resolve("expenses_included_in_valuation_account", INITIAL_ACCOUNT_IDS.landedCostClearing),
    accumulatedDepreciationAccount: resolve("accumulated_depreciation_account", "ACC-1290"),
    depreciationExpenseAccount: resolve("depreciation_expense_account", "ACC-6800"),
    gainLossAccountOnAssetDisposal: resolve("gain_loss_account_on_asset_disposal", "ACC-6990"),
    capitalWorkInProgressAccount: resolve("capital_work_in_progress_account", "ACC-1210"),
    assetReceivedButNotBilledAccount: resolve("asset_received_but_not_billed_account", "ACC-2160"),
    expensesIncludedInAssetValuationAccount: resolve("expenses_included_in_asset_valuation_account", "ACC-6990"),
  };
}
