export type ErpAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "INCOME" | "EXPENSE" | "CONTRA_ASSET" | "CONTRA_LIABILITY";

export type FinanceSetupSettingsConfig = {
  defaultReceivableAccount: string;
  defaultPayableAccount: string;
  defaultCashAccount: string;
  defaultBankAccount: string;
  retainedEarningsAccount: string;
  roundOffAccount: string;
  exchangeGainLossAccount: string;
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
  roundOffCostCenter: string;
  defaultCostCenter: string;
  assetDepreciationCostCenter: string;
  creditLimit: string;
  enablePerpetualInventory: boolean;
  enablePerpetualInventoryForNonStockItems: boolean;
};

export type ErpAccountSettingConfigKey = {
  [Key in keyof FinanceSetupSettingsConfig]: FinanceSetupSettingsConfig[Key] extends string ? Key : never
}[keyof FinanceSetupSettingsConfig];

export type ErpAccountSettingField = {
  configKey: ErpAccountSettingConfigKey;
  settingKey: string;
  label: string;
  allowedTypes: ErpAccountType[];
  required: boolean;
  note: string;
  section: "accounts" | "stock" | "fixedAssets";
};

export type ErpTextSettingField = {
  configKey: ErpAccountSettingConfigKey;
  settingKey: string;
  label: string;
  required: boolean;
  note: string;
  type?: "text" | "number";
};

export type ErpCostCenterSettingField = {
  configKey: "roundOffCostCenter" | "defaultCostCenter" | "assetDepreciationCostCenter";
  settingKey: string;
  label: string;
  required: boolean;
  note: string;
};

export const DEFAULT_FINANCE_SETUP_SETTINGS: FinanceSetupSettingsConfig = {
  defaultReceivableAccount: "",
  defaultPayableAccount: "",
  defaultCashAccount: "",
  defaultBankAccount: "",
  retainedEarningsAccount: "",
  roundOffAccount: "",
  exchangeGainLossAccount: "",
  defaultEmployeeAdvanceAccount: "",
  defaultCostOfGoodsSoldAccount: "",
  defaultIncomeAccount: "",
  defaultDeferredRevenueAccount: "",
  defaultDeferredExpenseAccount: "",
  defaultPayrollPayableAccount: "",
  defaultExpenseClaimPayableAccount: "",
  defaultPaymentDiscountAccount: "",
  writeOffAccount: "",
  unrealizedExchangeGainLossAccount: "",
  unrealizedProfitLossAccount: "",
  defaultInventoryAccount: "",
  stockAdjustmentAccount: "",
  stockReceivedButNotBilledAccount: "",
  serviceReceivedButNotBilledAccount: "",
  expensesIncludedInValuationAccount: "",
  accumulatedDepreciationAccount: "",
  depreciationExpenseAccount: "",
  gainLossAccountOnAssetDisposal: "",
  capitalWorkInProgressAccount: "",
  assetReceivedButNotBilledAccount: "",
  expensesIncludedInAssetValuationAccount: "",
  roundOffCostCenter: "Main",
  defaultCostCenter: "Main",
  assetDepreciationCostCenter: "Main",
  creditLimit: "0.00",
  enablePerpetualInventory: true,
  enablePerpetualInventoryForNonStockItems: false,
};

export const ERP_ACCOUNT_SETTING_FIELDS: ErpAccountSettingField[] = [
  { configKey: "defaultBankAccount", settingKey: "default_bank_account", label: "Default Bank Account", allowedTypes: ["ASSET"], required: true, note: "Primary bank ledger used by receipts and payments.", section: "accounts" },
  { configKey: "defaultCashAccount", settingKey: "default_cash_account", label: "Default Cash Account", allowedTypes: ["ASSET"], required: true, note: "Cash ledger used when payment mode is cash.", section: "accounts" },
  { configKey: "defaultReceivableAccount", settingKey: "default_receivable_account", label: "Default Receivable Account", allowedTypes: ["ASSET"], required: true, note: "Customer outstanding control account.", section: "accounts" },
  { configKey: "roundOffAccount", settingKey: "round_off_account", label: "Round Off Account", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: true, note: "Small rounding differences on posting.", section: "accounts" },
  { configKey: "writeOffAccount", settingKey: "write_off_account", label: "Write Off Account", allowedTypes: ["EXPENSE"], required: true, note: "Bad debt and small balance write-off account.", section: "accounts" },
  { configKey: "exchangeGainLossAccount", settingKey: "exchange_gain_loss_account", label: "Exchange Gain / Loss Account", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: true, note: "Realized FX gain/loss account.", section: "accounts" },
  { configKey: "unrealizedExchangeGainLossAccount", settingKey: "unrealized_exchange_gain_loss_account", label: "Unrealized Exchange Gain/Loss Account", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: false, note: "Optional period-end revaluation gain/loss account.", section: "accounts" },
  { configKey: "unrealizedProfitLossAccount", settingKey: "unrealized_profit_loss_account", label: "Unrealized Profit / Loss Account", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: false, note: "Optional unrealized profit/loss control.", section: "accounts" },
  { configKey: "defaultPayableAccount", settingKey: "default_payable_account", label: "Default Payable Account", allowedTypes: ["LIABILITY"], required: true, note: "Supplier outstanding control account.", section: "accounts" },
  { configKey: "defaultEmployeeAdvanceAccount", settingKey: "default_employee_advance_account", label: "Default Employee Advance Account", allowedTypes: ["ASSET"], required: true, note: "Employee/staff advance control account.", section: "accounts" },
  { configKey: "defaultCostOfGoodsSoldAccount", settingKey: "default_cost_of_goods_sold_account", label: "Default Cost of Goods Sold Account", allowedTypes: ["EXPENSE"], required: true, note: "Default COGS account for stock issue when item-level account is blank.", section: "accounts" },
  { configKey: "defaultIncomeAccount", settingKey: "default_income_account", label: "Default Income Account", allowedTypes: ["REVENUE", "INCOME"], required: true, note: "Default revenue account when item-level revenue account is blank.", section: "accounts" },
  { configKey: "defaultDeferredRevenueAccount", settingKey: "default_deferred_revenue_account", label: "Default Deferred Revenue Account", allowedTypes: ["LIABILITY"], required: false, note: "Optional contract liability account for deferred revenue.", section: "accounts" },
  { configKey: "defaultDeferredExpenseAccount", settingKey: "default_deferred_expense_account", label: "Default Deferred Expense Account", allowedTypes: ["ASSET"], required: false, note: "Optional prepaid/deferred expense account.", section: "accounts" },
  { configKey: "defaultPayrollPayableAccount", settingKey: "default_payroll_payable_account", label: "Default Payroll Payable Account", allowedTypes: ["LIABILITY"], required: true, note: "Payroll liability account.", section: "accounts" },
  { configKey: "defaultExpenseClaimPayableAccount", settingKey: "default_expense_claim_payable_account", label: "Default Expense Claim Payable Account", allowedTypes: ["LIABILITY"], required: false, note: "Optional employee expense claim payable account.", section: "accounts" },
  { configKey: "defaultPaymentDiscountAccount", settingKey: "default_payment_discount_account", label: "Default Payment Discount Account", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: false, note: "Optional early payment discount account.", section: "accounts" },
];

export const ERP_STOCK_SETTING_FIELDS: ErpAccountSettingField[] = [
  { configKey: "defaultInventoryAccount", settingKey: "default_inventory_account", label: "Default Inventory Account", allowedTypes: ["ASSET"], required: true, note: "Inventory asset account used for perpetual stock valuation.", section: "stock" },
  { configKey: "stockAdjustmentAccount", settingKey: "stock_adjustment_account", label: "Stock Adjustment Account", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: true, note: "Stock take variance, NRV write-down, and revaluation offset account.", section: "stock" },
  { configKey: "stockReceivedButNotBilledAccount", settingKey: "stock_received_but_not_billed_account", label: "Stock Received But Not Billed", allowedTypes: ["LIABILITY"], required: true, note: "GRNI liability account for purchase receipts before supplier bill.", section: "stock" },
  { configKey: "serviceReceivedButNotBilledAccount", settingKey: "service_received_but_not_billed_account", label: "Service Received But Not Billed", allowedTypes: ["LIABILITY"], required: false, note: "Optional service accrual liability.", section: "stock" },
  { configKey: "expensesIncludedInValuationAccount", settingKey: "expenses_included_in_valuation_account", label: "Expenses Included In Valuation", allowedTypes: ["EXPENSE", "ASSET"], required: true, note: "Landed cost or valuation expense clearing account.", section: "stock" },
];

export const ERP_FIXED_ASSET_SETTING_FIELDS: ErpAccountSettingField[] = [
  { configKey: "accumulatedDepreciationAccount", settingKey: "accumulated_depreciation_account", label: "Accumulated Depreciation Account", allowedTypes: ["CONTRA_ASSET", "ASSET"], required: false, note: "Contra-asset account for accumulated depreciation.", section: "fixedAssets" },
  { configKey: "depreciationExpenseAccount", settingKey: "depreciation_expense_account", label: "Depreciation Expense Account", allowedTypes: ["EXPENSE"], required: false, note: "Depreciation P&L expense account.", section: "fixedAssets" },
  { configKey: "gainLossAccountOnAssetDisposal", settingKey: "gain_loss_account_on_asset_disposal", label: "Gain/Loss Account on Asset Disposal", allowedTypes: ["EXPENSE", "REVENUE", "INCOME"], required: false, note: "Gain/loss account for fixed asset disposal.", section: "fixedAssets" },
  { configKey: "capitalWorkInProgressAccount", settingKey: "capital_work_in_progress_account", label: "Capital Work In Progress Account", allowedTypes: ["ASSET"], required: false, note: "CWIP account for assets under construction.", section: "fixedAssets" },
  { configKey: "assetReceivedButNotBilledAccount", settingKey: "asset_received_but_not_billed_account", label: "Asset Received But Not Billed", allowedTypes: ["LIABILITY"], required: false, note: "Accrual liability for received fixed assets not yet billed.", section: "fixedAssets" },
  { configKey: "expensesIncludedInAssetValuationAccount", settingKey: "expenses_included_in_asset_valuation_account", label: "Expenses Included In Asset Valuation", allowedTypes: ["EXPENSE", "ASSET"], required: false, note: "Asset valuation cost clearing account.", section: "fixedAssets" },
];

export const ERP_TEXT_SETTING_FIELDS: ErpTextSettingField[] = [
  { configKey: "creditLimit", settingKey: "default_credit_limit", label: "Credit Limit", required: false, note: "Default customer credit limit.", type: "number" },
];

export const ERP_COST_CENTER_SETTING_FIELDS: ErpCostCenterSettingField[] = [
  { configKey: "roundOffCostCenter", settingKey: "round_off_cost_center", label: "Round Off Cost Center", required: true, note: "Cost center used for round-off entries." },
  { configKey: "defaultCostCenter", settingKey: "default_cost_center", label: "Default Cost Center", required: true, note: "Default cost center automatically assigned to revenue, expense and COGS postings." },
  { configKey: "assetDepreciationCostCenter", settingKey: "asset_depreciation_cost_center", label: "Asset Depreciation Cost Center", required: true, note: "Cost center for generated asset depreciation entries." },
];

export const ALL_ERP_ACCOUNT_SETTING_FIELDS = [
  ...ERP_ACCOUNT_SETTING_FIELDS,
  ...ERP_STOCK_SETTING_FIELDS,
  ...ERP_FIXED_ASSET_SETTING_FIELDS,
] as const;

export const ALL_ERP_SETTING_KEYS = [
  ...ALL_ERP_ACCOUNT_SETTING_FIELDS.map((field) => field.settingKey),
  ...ERP_COST_CENTER_SETTING_FIELDS.map((field) => field.settingKey),
  ...ERP_TEXT_SETTING_FIELDS.map((field) => field.settingKey),
  "enable_perpetual_inventory",
  "enable_perpetual_inventory_for_non_stock_items",
] as const;
