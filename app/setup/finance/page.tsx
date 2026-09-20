"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ALL_ERP_ACCOUNT_SETTING_FIELDS,
  DEFAULT_FINANCE_SETUP_SETTINGS,
  ERP_ACCOUNT_SETTING_FIELDS,
  ERP_COST_CENTER_SETTING_FIELDS,
  ERP_FIXED_ASSET_SETTING_FIELDS,
  ERP_STOCK_SETTING_FIELDS,
  ERP_TEXT_SETTING_FIELDS,
  type ErpAccountSettingField,
  type ErpAccountSettingConfigKey,
  type ErpAccountType,
  type ErpCostCenterSettingField,
  type FinanceSetupSettingsConfig,
  type ErpTextSettingField,
} from "@/lib/accounting/finance-settings";

type BaseConfig = {
  companyName: string; companyShortName: string; country: string; registrationNo: string;
  baseCurrency: string; financialYearPeriod: string; gstStatus: string; gstNumber: string; gstEvidenceNote: string; gstEvidenceDocName: string; accountingMethod: string; inventoryMethod: string;
  businessType: string; customBusinessType: string; openingMode: string; openingDate: string; defaultReceivableAccount: string; defaultPayableAccount: string;
  defaultCashAccount: string; defaultBankAccount: string; retainedEarningsAccount: string; roundOffAccount: string;
  exchangeGainLossAccount: string;
};
type Config = BaseConfig & FinanceSetupSettingsConfig;
type Overview = { status: string; completedStepIndex: number; highestUnlockedStep: number; setupActive: boolean; config: Config; metrics: { coaCount: number; customerCount: number; supplierCount: number; itemCount: number }; checks: Record<string, boolean>; configurationReady: boolean; openingValidated: boolean; readyForGoLive: boolean };
type BalanceLine = { accountCode: string; debit: string; credit: string; label: string };
type SavedOpeningBalanceEntry = { accountCode: string; debit?: number; credit?: number; label?: string };
type OverviewPayload = Overview & { openingBalanceEntries?: SavedOpeningBalanceEntry[] };
type Validation = { valid: boolean; errors: string[]; totalDebit: number; totalCredit: number; difference: number };
type AccountApiRow = { accountId?: string; id?: string; accountCode?: string; code?: string; accountName?: string; name?: string; accountType?: string; type?: string; parentId?: string | null; parentAccount?: string; parentCode?: string | null; parentName?: string | null; normalBalance?: string; active?: boolean; isActive?: boolean; isGroup?: boolean; childCount?: number };
type SetupAccount = { accountId: string; accountCode: string; accountName: string; accountType: string; parentId: string | null; parentAccount: string; normalBalance: string; active: boolean; isGroup: boolean; children: SetupAccount[] };
type CostCenterOption = { id: string; code: string; name: string; isActive: boolean; isGroup: boolean; childCount: number; display: string };
type MappingAccountKey = ErpAccountSettingConfigKey;
type MappingSuggestionNotes = Partial<Record<MappingAccountKey, string>>;
type AccountCreateType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "CONTRA_ASSET" | "CONTRA_LIABILITY";
type QuickAccountForm = { code: string; name: string; type: AccountCreateType; normalBalance: "DEBIT" | "CREDIT"; parentInput: string; description: string };
type QuickCostCenterForm = { code: string; name: string; parentRef: string; description: string };

const initialConfig: Config = {
  companyName: "",
  companyShortName: "",
  country: "Papua New Guinea",
  registrationNo: "",
  baseCurrency: "PGK",
  financialYearPeriod: "FY 2026 (01 Jan 2026 - 31 Dec 2026)",
  gstStatus: "UNVERIFIED",
  gstNumber: "",
  gstEvidenceNote: "",
  gstEvidenceDocName: "",
  accountingMethod: "ACCRUAL",
  inventoryMethod: "PERPETUAL",
  businessType: "IT_TECHNOLOGY",
  customBusinessType: "",
  openingMode: "NEW_BUSINESS",
  openingDate: "2026-09-01",
  ...DEFAULT_FINANCE_SETUP_SETTINGS,
};
const steps = ["Company", "Business & accounting", "Chart of Accounts", "Default accounts", "Opening position", "Balances", "Review", "Go live"];
const balanceDefaults: BalanceLine[] = [
  { accountCode: "1121", debit: "", credit: "", label: "Bank" }, { accountCode: "1111", debit: "", credit: "", label: "Cash" },
  { accountCode: "1131", debit: "", credit: "", label: "Accounts receivable" }, { accountCode: "1151", debit: "", credit: "", label: "Prepayments" },
  { accountCode: "1211", debit: "", credit: "", label: "Fixed assets" }, { accountCode: "2111", debit: "", credit: "", label: "Accounts payable" },
  { accountCode: "2131", debit: "", credit: "", label: "Loan / statutory payable" }, { accountCode: "3100", debit: "", credit: "", label: "Share capital" },
  { accountCode: "3200", debit: "", credit: "", label: "Retained earnings" },
];

const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK" }).format(value);
const balanceValue = (value: unknown) => Number(value || 0) ? String(value) : "";
const hydrateBalanceEntries = (entries: SavedOpeningBalanceEntry[]) => entries.map((entry) => ({
  accountCode: String(entry.accountCode || ""),
  debit: balanceValue(entry.debit),
  credit: balanceValue(entry.credit),
  label: String(entry.label || entry.accountCode || "Opening balance"),
})).filter((entry) => entry.accountCode);
const LOCKED_ACCOUNTING_METHOD = "ACCRUAL";
const LOCKED_INVENTORY_METHOD = "PERPETUAL";
const PNG_FINANCIAL_YEAR_PERIODS = [
  { value: "FY 2026 (01 Jan 2026 - 31 Dec 2026)", label: "FY 2026 (01 Jan 2026 - 31 Dec 2026) — Current PNG Financial Year" },
  { value: "FY 2025 (01 Jan 2025 - 31 Dec 2025)", label: "FY 2025 (01 Jan 2025 - 31 Dec 2025) — Prior Financial Year" },
  { value: "FY 2027 (01 Jan 2027 - 31 Dec 2027)", label: "FY 2027 (01 Jan 2027 - 31 Dec 2027) — Next Financial Year" },
  { value: "FY 2024 (01 Jan 2024 - 31 Dec 2024)", label: "FY 2024 (01 Jan 2024 - 31 Dec 2024) — Historical" },
] as const;
const GST_STATUSES = [
  { value: "UNVERIFIED", label: "UNVERIFIED — Registration not yet verified against IRC registry" },
  { value: "REGISTERED", label: "REGISTERED — Registered for GST" },
  { value: "VERIFIED", label: "VERIFIED — Formally verified with retained evidence" },
  { value: "NOT_REGISTERED", label: "NOT_REGISTERED — Not registered for GST" },
  { value: "EXEMPT", label: "EXEMPT — Statutory exemption" },
] as const;
const accountingMethodLabel = "Accrual accounting";
const inventoryMethodLabel = "Perpetual inventory";
const lockAccountingMethods = (input: Config): Config => ({ ...input, accountingMethod: LOCKED_ACCOUNTING_METHOD, inventoryMethod: LOCKED_INVENTORY_METHOD });
const cleanAccountCode = (value: string) => value.split("—")[0].trim().replace(/^ACC-/i, "");
const accountLabel = (account: SetupAccount) => `${account.accountCode} — ${account.accountName}`;
const cleanCostCenterCode = (value: string) => value.split("—")[0].trim();
const costCenterLabel = (row: CostCenterOption) => `${row.code} — ${row.name}`;
const normalizeAccountType = (value: string) => value.replaceAll("_", " ").toUpperCase();
const createAccountType = (type: ErpAccountType): AccountCreateType => type === "INCOME" ? "REVENUE" : type;
const normalBalanceForType = (type: AccountCreateType): "DEBIT" | "CREDIT" => ["LIABILITY", "EQUITY", "REVENUE", "CONTRA_ASSET"].includes(type) ? "CREDIT" : "DEBIT";
const accountTypeAllowed = (account: SetupAccount, allowedTypes: readonly string[]) => {
  const accountType = normalizeAccountType(account.accountType);
  return allowedTypes.some((type) => normalizeAccountType(type) === accountType || (type === "INCOME" && accountType === "REVENUE"));
};
const mappingAccountFields = ALL_ERP_ACCOUNT_SETTING_FIELDS;
const suggestionProfiles: Partial<Record<MappingAccountKey, { positive: string[]; negative: string[]; codeHints: string[] }>> = {
  defaultReceivableAccount: { positive: ["accounts receivable", "trade receivable", "receivables", "debtors", "customer receivable", "customer outstanding"], negative: ["gst", "tax", "input", "prepaid", "advance", "deposit"], codeHints: ["113", "120"] },
  defaultPayableAccount: { positive: ["accounts payable", "trade payable", "payables", "creditors", "supplier payable", "supplier outstanding"], negative: ["gst", "tax", "output", "loan", "payroll", "salary"], codeHints: ["211", "210"] },
  defaultCashAccount: { positive: ["cash on hand", "cash in hand", "cash account", "petty cash", "till"], negative: ["bank", "receivable", "advance", "prepaid", "clearing", "gst"], codeHints: ["111"] },
  defaultBankAccount: { positive: ["bank account", "operating bank", "main bank", "business bank", "current account", "transaction account", "checking"], negative: ["cash on hand", "petty cash", "receivable", "loan", "clearing", "gst"], codeHints: ["112"] },
  retainedEarningsAccount: { positive: ["retained earnings", "accumulated profit", "retained profit", "opening equity", "prior year earnings"], negative: ["share capital", "drawings", "current year", "revaluation"], codeHints: ["320"] },
  roundOffAccount: { positive: ["round", "rounding", "round off", "round-off", "write off", "write-off", "small balance", "miscellaneous expense", "other expense"], negative: ["depreciation", "salary", "tax", "cogs", "purchases", "revenue"], codeHints: ["68", "69", "49"] },
  exchangeGainLossAccount: { positive: ["foreign exchange", "exchange gain", "exchange loss", "forex", "fx gain", "fx loss", "currency gain", "currency loss", "unrealised exchange"], negative: ["round", "gst", "sales", "cogs", "salary"], codeHints: ["49", "68", "69"] },
  defaultInventoryAccount: { positive: ["inventory", "stock", "materials", "project materials"], negative: ["adjustment", "variance", "payable", "receivable"], codeHints: ["115"] },
  stockReceivedButNotBilledAccount: { positive: ["stock received but not billed", "grni", "goods received not invoiced", "received but not billed"], negative: ["inventory asset", "sales", "expense"], codeHints: ["219"] },
  defaultCostOfGoodsSoldAccount: { positive: ["cost of goods", "cogs", "hardware", "materials cost", "cost of sales"], negative: ["inventory asset", "revenue", "income"], codeHints: ["51", "50"] },
  defaultIncomeAccount: { positive: ["revenue", "sales", "income"], negative: ["cost", "expense", "cogs"], codeHints: ["41", "42", "43", "44"] },
  stockAdjustmentAccount: { positive: ["stock adjustment", "stock take", "variance", "inventory adjustment", "nrv", "write-down", "revaluation"], negative: ["inventory asset", "receivable", "payable"], codeHints: ["512", "491"] },
  expensesIncludedInValuationAccount: { positive: ["landed cost", "valuation", "freight", "clearing"], negative: ["revenue", "receivable"], codeHints: ["219", "55"] },
  defaultPayrollPayableAccount: { positive: ["payroll", "wages", "salary", "staff deductions", "payable"], negative: ["expense"], codeHints: ["217", "212"] },
  defaultEmployeeAdvanceAccount: { positive: ["employee advance", "staff advance", "loan", "advance"], negative: ["supplier", "customer"], codeHints: ["118"] },
  writeOffAccount: { positive: ["write off", "write-off", "bad debt", "impairment"], negative: ["round", "stock"], codeHints: ["698", "699"] },
};
const normalizeSetupAccount = (row: AccountApiRow): SetupAccount => {
  const parentName = [row.parentCode, row.parentName].filter(Boolean).join(" — ");
  return {
    accountId: String(row.accountId || row.id || row.accountCode || row.code || ""),
    accountCode: String(row.accountCode || row.code || ""),
    accountName: String(row.accountName || row.name || ""),
    accountType: String(row.accountType || row.type || ""),
    parentId: row.parentId ? String(row.parentId) : null,
    parentAccount: row.parentAccount || parentName,
    normalBalance: String(row.normalBalance || ""),
    active: row.active ?? row.isActive ?? true,
    isGroup: Boolean(row.isGroup || (row.childCount ?? 0) > 0),
    children: [],
  };
};

export default function FinanceSetupPage() {
  const router = useRouter();
  const [config, setConfig] = useState<Config>(initialConfig);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [step, setStep] = useState(0);
  const [balances, setBalances] = useState<BalanceLine[]>(balanceDefaults);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [coaFile, setCoaFile] = useState<File | null>(null);
  const [coaImporting, setCoaImporting] = useState(false);
  const [standardCoaCreating, setStandardCoaCreating] = useState(false);
  const [setupAccounts, setSetupAccounts] = useState<SetupAccount[]>([]);
  const [coaLoading, setCoaLoading] = useState(false);
  const [coaView, setCoaView] = useState<"tree" | "list">("tree");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [mappingSuggestionNotes, setMappingSuggestionNotes] = useState<MappingSuggestionNotes>({});
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  const [costCenterLoading, setCostCenterLoading] = useState(false);
  const [quickAccountField, setQuickAccountField] = useState<ErpAccountSettingField | null>(null);
  const [quickAccountForm, setQuickAccountForm] = useState<QuickAccountForm>({ code: "", name: "", type: "ASSET", normalBalance: "DEBIT", parentInput: "", description: "" });
  const [quickCostCenterField, setQuickCostCenterField] = useState<ErpCostCenterSettingField | null>(null);
  const [quickCostCenterForm, setQuickCostCenterForm] = useState<QuickCostCenterForm>({ code: "", name: "", parentRef: "", description: "" });
  const [quickCreateBusy, setQuickCreateBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [gstCertificateFile, setGstCertificateFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/setup/workflow", { cache: "no-store" });
      const body = await response.json() as OverviewPayload & { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Setup workflow unavailable");
      setOverview(body);
      setConfig((current) => lockAccountingMethods({ ...current, ...body.config }));
      if (Array.isArray(body.openingBalanceEntries) && body.openingBalanceEntries.length) setBalances(hydrateBalanceEntries(body.openingBalanceEntries));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Setup workflow unavailable"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const fetchSetupAccounts = useCallback(async () => {
    const response = await fetch("/api/ui/accounts", { cache: "no-store" });
    const body = await response.json() as { ok?: boolean; error?: string; accounts?: AccountApiRow[]; data?: AccountApiRow[] };
    if (!response.ok || !body.ok) throw new Error(body.error || "Chart of Accounts could not be loaded");
    const rows = Array.isArray(body.accounts) ? body.accounts : Array.isArray(body.data) ? body.data : [];
    return rows.map(normalizeSetupAccount).filter((account) => account.accountId && account.accountCode);
  }, []);
  const loadSetupAccounts = useCallback(async () => {
    setCoaLoading(true);
    try {
      const accounts = await fetchSetupAccounts();
      setSetupAccounts(accounts);
      return accounts;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chart of Accounts could not be loaded"); }
    finally { setCoaLoading(false); }
    return [];
  }, [fetchSetupAccounts]);
  const loadCostCenters = useCallback(async () => {
    setCostCenterLoading(true);
    try {
      const response = await fetch("/api/cost-centers", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; error?: string; costCenters?: CostCenterOption[] };
      if (!response.ok || !body.ok) throw new Error(body.error || "Cost Centers could not be loaded");
      setCostCenters(body.costCenters || []);
      return body.costCenters || [];
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cost Centers could not be loaded");
      return [];
    } finally {
      setCostCenterLoading(false);
    }
  }, []);
  const patch = (key: keyof Config, value: string) => setConfig((current) => ({ ...current, [key]: value }));
  const patchBoolean = (key: keyof Pick<FinanceSetupSettingsConfig, "enablePerpetualInventory" | "enablePerpetualInventoryForNonStockItems">, value: boolean) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };
  const save = async (): Promise<Overview | null> => {
    setBusy(true); setError(""); setMessage("");
    try {
      const lockedConfig = lockAccountingMethods(config);
      setConfig(lockedConfig);
      const response = await fetch("/api/setup/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-config", config: lockedConfig, completedStepIndex: step }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Configuration could not be saved");
      setOverview(body); setMessage("Configuration saved without creating any accounting transaction."); return body as Overview;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Configuration could not be saved"); return null; }
    finally { setBusy(false); }
  };
  const importChartOfAccounts = async () => {
    if (!coaFile) {
      setError("Select a Chart of Accounts CSV or Excel file before importing.");
      return;
    }
    setCoaImporting(true); setError(""); setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", coaFile);
      const response = await fetch("/api/ui/accounts/import", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Chart of Accounts import failed");
      setMessage(body.message || "Chart of Accounts imported successfully.");
      setCoaFile(null);
      await load();
      await loadSetupAccounts();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chart of Accounts import failed"); }
    finally { setCoaImporting(false); }
  };
  const createStandardCoa = async () => {
    setStandardCoaCreating(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/ui/accounts/standard", { method: "POST" });
      const body = await response.json() as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Standard Chart of Accounts could not be created");
      setMessage(body.message || "Standard Chart of Accounts created.");
      await loadSetupAccounts();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Standard Chart of Accounts could not be created"); }
    finally { setStandardCoaCreating(false); }
  };
  const validate = async (): Promise<boolean> => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/setup/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate-opening", entries: balances.filter(({ debit, credit }) => debit.trim() || credit.trim()).map(({ accountCode, debit, credit, label }) => ({ accountCode, debit: Number(debit || 0), credit: Number(credit || 0), label })) }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Opening balance validation failed");
      setValidation(body); setMessage(body.valid ? `Opening balance control passed${body.openingJournal?.code ? ` and posted as ${body.openingJournal.code}` : ""}.` : "Opening balance requires correction before go-live.");
      if (body.overview) setOverview(body.overview as Overview);
      else await load();
      return Boolean(body.valid);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Opening balance validation failed"); return false; }
    finally { setBusy(false); }
  };
  const saveReview = async (): Promise<Overview | null> => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/setup/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark-review-complete" }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Review could not be saved");
      setOverview(body); setMessage("Review saved. Go-live step is now unlocked."); return body as Overview;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review could not be saved"); return null; }
    finally { setBusy(false); }
  };
  const activate = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/setup/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate" }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Setup is not ready for activation");
      setOverview(body); setEditMode(false); setMessage("Successfully saved. System is ready to use."); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Setup is not ready for activation"); }
    finally { setBusy(false); }
  };
  const totals = useMemo(() => balances.reduce((result, row) => ({ debit: result.debit + Number(row.debit || 0), credit: result.credit + Number(row.credit || 0) }), { debit: 0, credit: 0 }), [balances]);
  const coaTree = useMemo(() => {
    const nodes = new Map(setupAccounts.map((account) => [account.accountId, { ...account, children: [] as SetupAccount[] }]));
    const roots: SetupAccount[] = [];
    nodes.forEach((account) => {
      if (account.parentId && nodes.has(account.parentId)) {
        nodes.get(account.parentId)?.children.push(account);
      } else {
        roots.push(account);
      }
    });
    const sortAccounts = (rows: SetupAccount[]) => {
      rows.sort((left, right) => left.accountCode.localeCompare(right.accountCode, undefined, { numeric: true }));
      rows.forEach((account) => sortAccounts(account.children));
    };
    sortAccounts(roots);
    return roots;
  }, [setupAccounts]);
  const renderAccountTreeRows = (rows: SetupAccount[], level = 0): ReactNode[] => rows.flatMap((account) => [
    <tr key={account.accountId}>
      <td style={{ paddingLeft: 12 + level * 20 }}><strong>{account.accountCode}</strong> — {account.accountName}</td>
      <td>{account.accountType.replaceAll("_", " ")}</td>
      <td><span className={`coa-status-pill ${account.active ? "valid" : "invalid"}`}>{account.active ? "Active" : "Inactive"}</span></td>
      <td>{account.isGroup ? "Group" : "Ledger"}</td>
    </tr>,
    ...renderAccountTreeRows(account.children, level + 1),
  ]);
  const ledgerAccountOptions = useMemo(() => setupAccounts.filter((account) => account.active && !account.isGroup), [setupAccounts]);
  const accountByCode = useMemo(() => new Map(setupAccounts.map((account) => [account.accountCode, account])), [setupAccounts]);
  const activeCostCenters = useMemo(() => costCenters.filter((row) => row.isActive), [costCenters]);
  const costCenterByCode = useMemo(() => new Map(costCenters.map((row) => [row.code, row])), [costCenters]);
  const displayAccountValue = (value: string) => {
    const account = accountByCode.get(cleanAccountCode(value)) || setupAccounts.find((row) => row.accountId === value);
    return account ? accountLabel(account) : value;
  };
  const displayCostCenterValue = (value: string) => {
    const clean = cleanCostCenterCode(value);
    const row = costCenterByCode.get(clean) || costCenters.find((candidate) => candidate.id === value || candidate.name === value);
    return row ? costCenterLabel(row) : value;
  };
  const selectMappingAccount = (key: MappingAccountKey, input: string, options: SetupAccount[]) => {
    const normalized = input.trim().toLowerCase();
    const match = options.find((account) => [account.accountId, account.accountCode, account.accountName, accountLabel(account)].some((candidate) => String(candidate).toLowerCase() === normalized));
    patch(key, match ? match.accountCode : input.trim());
  };
  const openQuickAccountCreator = (field: ErpAccountSettingField) => {
    const [firstAllowedType = "ASSET"] = field.allowedTypes;
    const type = createAccountType(firstAllowedType);
    setQuickAccountField(field);
    setQuickCostCenterField(null);
    setQuickAccountForm({
      code: "",
      name: field.label.replace(/^Default\s+/i, "").replace(/\s+Account$/i, ""),
      type,
      normalBalance: normalBalanceForType(type),
      parentInput: "",
      description: field.note,
    });
  };
  const quickAccountAllowedTypes = (field: ErpAccountSettingField | null) => {
    const allowedTypes = field?.allowedTypes.length ? field.allowedTypes : (["ASSET"] as ErpAccountType[]);
    return Array.from(new Set(allowedTypes.map(createAccountType)));
  };
  const updateQuickAccountType = (type: AccountCreateType) => {
    setQuickAccountForm((current) => ({ ...current, type, normalBalance: normalBalanceForType(type), parentInput: "" }));
  };
  const saveQuickAccount = async () => {
    if (!quickAccountField) return;
    const code = quickAccountForm.code.trim().replace(/^ACC-/i, "");
    if (!code || !quickAccountForm.name.trim()) {
      setError("Account code and account name are required.");
      return;
    }
    const normalizedParent = quickAccountForm.parentInput.trim().toLowerCase();
    const parent = normalizedParent
      ? setupAccounts.find((account) => [account.accountId, account.accountCode, account.accountName, accountLabel(account)].some((candidate) => String(candidate).toLowerCase() === normalizedParent))
      : null;
    if (normalizedParent && !parent) {
      setError("Select a parent account from the list, or leave parent blank.");
      return;
    }
    setQuickCreateBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/ui/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: quickAccountForm.name.trim(),
          type: quickAccountForm.type,
          parentId: parent?.accountId || "",
          normalBalance: quickAccountForm.normalBalance,
          currency: config.baseCurrency || "PGK",
          description: quickAccountForm.description,
          isActive: true,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Account create failed");
      const accounts = await loadSetupAccounts();
      const created = accounts.find((account) => account.accountCode === code) || normalizeSetupAccount(body.account || { accountCode: code, accountName: quickAccountForm.name, accountType: quickAccountForm.type });
      patch(quickAccountField.configKey, created.accountCode);
      setQuickAccountField(null);
      setMessage(`${accountLabel(created)} created in Chart of Accounts and selected for ${quickAccountField.label}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account create failed");
    } finally {
      setQuickCreateBusy(false);
    }
  };
  const renderMappingAccountField = (field: ErpAccountSettingField) => {
    const key = field.configKey;
    const options = ledgerAccountOptions.filter((account) => accountTypeAllowed(account, field.allowedTypes));
    const listId = `setup-${key}-chart-accounts`;
    return <div key={field.settingKey} className="field-with-action"><label>{field.label}{field.required && <span className="required-star">*</span>}<input list={listId} value={displayAccountValue(String(config[key] || ""))} onChange={(event) => selectMappingAccount(key, event.target.value, options)} placeholder={`Search ${field.allowedTypes.join(" / ")} account by no or name`} required={field.required} disabled={busy || coaLoading || !chartReady} autoComplete="off" /><datalist id={listId}>{options.map((account) => <option key={account.accountId} value={accountLabel(account)}>{accountLabel(account)}</option>)}</datalist><span className="small">{field.note} {field.required ? "Required active ledger account." : "Optional active ledger account."} Group accounts are blocked.</span></label><button type="button" className="secondary-btn" onClick={() => openQuickAccountCreator(field)} disabled={busy || quickCreateBusy || coaLoading || !chartReady}>+ Create New Account</button></div>;
  };
  const renderTextSettingField = (field: ErpTextSettingField) => {
    const key = field.configKey;
    return <label key={field.settingKey}>{field.label}{field.required && <span className="required-star">*</span>}<input type={field.type || "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" ? "0.01" : undefined} value={String(config[key] ?? "")} onChange={(event) => patch(key, event.target.value)} required={field.required} disabled={busy} /><span className="small">{field.note}</span></label>;
  };
  const selectCostCenter = (key: ErpCostCenterSettingField["configKey"], input: string) => {
    const normalized = input.trim().toLowerCase();
    const match = activeCostCenters.find((row) => [row.id, row.code, row.name, costCenterLabel(row), row.display].some((candidate) => String(candidate).toLowerCase() === normalized));
    patch(key, match ? match.code : cleanCostCenterCode(input));
  };
  const openQuickCostCenterCreator = (field: ErpCostCenterSettingField) => {
    setQuickCostCenterField(field);
    setQuickAccountField(null);
    setQuickCostCenterForm({ code: "", name: field.label.replace(/\s+Cost Center$/i, ""), parentRef: "", description: field.note });
  };
  const saveQuickCostCenter = async () => {
    if (!quickCostCenterField) return;
    if (!quickCostCenterForm.name.trim()) {
      setError("Cost Center name is required.");
      return;
    }
    const parentInput = quickCostCenterForm.parentRef.trim();
    const normalizedParent = parentInput.toLowerCase();
    const parent = normalizedParent
      ? activeCostCenters.find((row) => [row.id, row.code, row.name, costCenterLabel(row), row.display].some((candidate) => String(candidate).toLowerCase() === normalizedParent))
      : null;
    if (normalizedParent && !parent) {
      setError("Select a parent Cost Center from the list, or leave parent blank.");
      return;
    }
    setQuickCreateBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/cost-centers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...quickCostCenterForm, parentRef: parent?.code || "", isActive: true }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Cost Center create failed");
      const rows = await loadCostCenters();
      const createdCode = String(body.row?.code || quickCostCenterForm.code || quickCostCenterForm.name).trim();
      const created = rows.find((row) => row.code === createdCode || row.name === quickCostCenterForm.name) || body.row;
      patch(quickCostCenterField.configKey, String(created?.code || createdCode));
      setQuickCostCenterField(null);
      setMessage(`${created?.display || createdCode} created and selected for ${quickCostCenterField.label}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cost Center create failed");
    } finally {
      setQuickCreateBusy(false);
    }
  };
  const renderCostCenterSettingField = (field: ErpCostCenterSettingField) => {
    const listId = `setup-${field.configKey}-cost-centers`;
    return <div key={field.settingKey} className="field-with-action"><label>{field.label}{field.required && <span className="required-star">*</span>}<input list={listId} value={displayCostCenterValue(String(config[field.configKey] || ""))} onChange={(event) => selectCostCenter(field.configKey, event.target.value)} required={field.required} disabled={busy || costCenterLoading} placeholder="Search Cost Center by code or name" autoComplete="off" /><datalist id={listId}>{activeCostCenters.map((row) => <option key={row.id} value={costCenterLabel(row)}>{costCenterLabel(row)}</option>)}</datalist><span className="small">{field.note} Select an active Cost Center master record.</span></label><button type="button" className="secondary-btn" onClick={() => openQuickCostCenterCreator(field)} disabled={busy || quickCreateBusy || costCenterLoading}>+ Create New Cost Center</button></div>;
  };
  const renderQuickAccountCreator = () => {
    if (!quickAccountField) return null;
    const allowedTypes = quickAccountAllowedTypes(quickAccountField);
    const parentOptions = setupAccounts
      .filter((account) => account.active && accountTypeAllowed(account, [quickAccountForm.type]))
      .sort((left, right) => Number(right.isGroup) - Number(left.isGroup) || left.accountCode.localeCompare(right.accountCode, undefined, { numeric: true }));
    return <div className="form-wide conversion-box">
      <div className="form-title-row">
        <div>
          <strong>Create account for {quickAccountField.label}</strong>
          <p className="small">This creates an active ledger in Chart of Accounts, then selects it for this field.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => setQuickAccountField(null)} disabled={quickCreateBusy}>Cancel</button>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label>Account Code<input value={quickAccountForm.code} onChange={(event) => setQuickAccountForm((current) => ({ ...current, code: event.target.value }))} placeholder="e.g. 1125" required disabled={quickCreateBusy} /></label>
        <label>Account Name<input value={quickAccountForm.name} onChange={(event) => setQuickAccountForm((current) => ({ ...current, name: event.target.value }))} required disabled={quickCreateBusy} /></label>
        <label>Account Type<select value={quickAccountForm.type} onChange={(event) => updateQuickAccountType(event.target.value as AccountCreateType)} disabled={quickCreateBusy}>{allowedTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
        <label>Normal Balance<input value={quickAccountForm.normalBalance} readOnly aria-readonly="true" /></label>
        <label className="form-wide">Parent Account<input list="quick-account-parent-options" value={quickAccountForm.parentInput} onChange={(event) => setQuickAccountForm((current) => ({ ...current, parentInput: event.target.value }))} placeholder="Optional: choose group/root parent from COA" disabled={quickCreateBusy} /><datalist id="quick-account-parent-options">{parentOptions.map((account) => <option key={account.accountId} value={accountLabel(account)}>{accountLabel(account)}</option>)}</datalist><span className="small">Recommended: choose the matching group/root account so the new ledger sits in the right COA tree.</span></label>
        <label className="form-wide">Description<input value={quickAccountForm.description} onChange={(event) => setQuickAccountForm((current) => ({ ...current, description: event.target.value }))} disabled={quickCreateBusy} /></label>
      </div>
      <div className="button-row" style={{ marginTop: 12 }}><button type="button" onClick={() => void saveQuickAccount()} disabled={quickCreateBusy}>{quickCreateBusy ? "Creating…" : "Create Account & Select"}</button></div>
    </div>;
  };
  const renderQuickCostCenterCreator = () => {
    if (!quickCostCenterField) return null;
    return <div className="form-wide conversion-box">
      <div className="form-title-row">
        <div>
          <strong>Create Cost Center for {quickCostCenterField.label}</strong>
          <p className="small">This creates an active Cost Center master record, then selects it for this field.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => setQuickCostCenterField(null)} disabled={quickCreateBusy}>Cancel</button>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label>Cost Center Code<input value={quickCostCenterForm.code} onChange={(event) => setQuickCostCenterForm((current) => ({ ...current, code: event.target.value }))} placeholder="Optional, auto from name if blank" disabled={quickCreateBusy} /></label>
        <label>Cost Center Name<input value={quickCostCenterForm.name} onChange={(event) => setQuickCostCenterForm((current) => ({ ...current, name: event.target.value }))} required disabled={quickCreateBusy} /></label>
        <label className="form-wide">Parent Cost Center<input list="quick-cost-center-parent-options" value={quickCostCenterForm.parentRef} onChange={(event) => setQuickCostCenterForm((current) => ({ ...current, parentRef: event.target.value }))} placeholder="Optional parent" disabled={quickCreateBusy} /><datalist id="quick-cost-center-parent-options">{activeCostCenters.map((row) => <option key={row.id} value={costCenterLabel(row)}>{costCenterLabel(row)}</option>)}</datalist></label>
        <label className="form-wide">Description<input value={quickCostCenterForm.description} onChange={(event) => setQuickCostCenterForm((current) => ({ ...current, description: event.target.value }))} disabled={quickCreateBusy} /></label>
      </div>
      <div className="button-row" style={{ marginTop: 12 }}><button type="button" onClick={() => void saveQuickCostCenter()} disabled={quickCreateBusy}>{quickCreateBusy ? "Creating…" : "Create Cost Center & Select"}</button></div>
    </div>;
  };
  const scoreSuggestedAccount = (field: ErpAccountSettingField, account: SetupAccount) => {
    const fallbackTerms = field.label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    const profile = suggestionProfiles[field.configKey] || { positive: fallbackTerms, negative: [], codeHints: [] };
    const haystack = `${account.accountCode} ${account.accountName} ${account.parentAccount} ${account.accountType}`.toLowerCase();
    let score = account.active && !account.isGroup ? 5 : -100;
    for (const keyword of profile.positive) {
      const term = keyword.toLowerCase();
      if (account.accountName.toLowerCase() === term) score += 40;
      else if (account.accountName.toLowerCase().includes(term)) score += 24;
      else if (haystack.includes(term)) score += 16;
    }
    for (const keyword of profile.negative) {
      if (haystack.includes(keyword.toLowerCase())) score -= 24;
    }
    for (const code of profile.codeHints) {
      if (account.accountCode.startsWith(code)) score += 10;
    }
    return score;
  };
  const confidenceLabel = (score: number) => score >= 58 ? "high confidence" : score >= 34 ? "medium confidence" : "low confidence";
  const suggestMappingAccounts = async () => {
    setAiSuggesting(true); setError(""); setMessage("");
    try {
      let accounts = setupAccounts;
      if (!accounts.length) accounts = await loadSetupAccounts();
      const activeLedgers = accounts.filter((account) => account.active && !account.isGroup);
      if (!activeLedgers.length) throw new Error("No active ledger accounts found. Import or refresh the Chart of Accounts first.");
      const updates: Partial<Record<MappingAccountKey, string>> = {};
      const notes: MappingSuggestionNotes = {};
      for (const field of mappingAccountFields) {
        const candidates = activeLedgers.filter((account) => accountTypeAllowed(account, field.allowedTypes));
        const ranked = candidates
          .map((account) => ({ account, score: scoreSuggestedAccount(field, account) }))
          .sort((left, right) => right.score - left.score || left.account.accountCode.localeCompare(right.account.accountCode, undefined, { numeric: true }));
        const best = ranked[0];
        if (best && best.score > 0) {
          updates[field.configKey] = best.account.accountCode;
          notes[field.configKey] = `${field.label}: ${accountLabel(best.account)} (${confidenceLabel(best.score)})`;
        } else {
          notes[field.configKey] = `${field.label}: no accurate active ledger match found`;
        }
      }
      setConfig((current) => ({ ...current, ...updates }));
      setMappingSuggestionNotes(notes);
      const suggestedCount = Object.keys(updates).length;
      setMessage(`${suggestedCount} AI suggested account selections applied from the existing Chart of Accounts. Please review each field before Save & continue.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI suggested account selection failed"); }
    finally { setAiSuggesting(false); }
  };
  const updateBalance = (index: number, field: "debit" | "credit", value: string) => setBalances((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  const gstSetupReady = Boolean(config.gstStatus && (config.gstStatus !== "VERIFIED" || (config.gstNumber.trim() && config.gstEvidenceDocName.trim())));
  const companyReady = Boolean(config.companyName.trim().length >= 2 && config.companyShortName.trim() && config.country.trim() && config.registrationNo.trim() && config.baseCurrency.trim() && config.financialYearPeriod.trim() && gstSetupReady);
  const customBusinessTypeReady = config.businessType !== "OTHER" || config.customBusinessType.trim().length >= 2;
  const businessReady = Boolean(config.businessType && customBusinessTypeReady && config.accountingMethod === LOCKED_ACCOUNTING_METHOD && config.inventoryMethod === LOCKED_INVENTORY_METHOD);
  const chartReady = Boolean(overview?.checks.chartOfAccounts || (overview?.metrics.coaCount ?? 0) > 0);
  useEffect(() => { if ((step === 2 || step === 3) && chartReady) void loadSetupAccounts(); }, [step, chartReady, loadSetupAccounts]);
  useEffect(() => { if (step === 3) void loadCostCenters(); }, [step, loadCostCenters]);
  const mappingFieldsReady = mappingAccountFields.every((field) => {
    const value = String(config[field.configKey] || "");
    if (!value.trim()) return !field.required;
    const account = accountByCode.get(cleanAccountCode(value));
    return Boolean(account && account.active && !account.isGroup && accountTypeAllowed(account, field.allowedTypes));
  });
  const costCenterFieldsReady = ERP_COST_CENTER_SETTING_FIELDS.every((field) => {
    const value = cleanCostCenterCode(String(config[field.configKey] || ""));
    if (!value) return !field.required;
    const row = costCenterByCode.get(value);
    return Boolean(row && row.isActive);
  });
  const openingPositionReady = Boolean(config.openingMode && config.openingDate);
  const openingBalanced = Boolean(validation?.valid || overview?.checks.openingValidated || overview?.openingValidated);
  const existingBusinessMigrationReady = config.openingMode === "EXISTING_BUSINESS" && openingBalanced;
  const reviewReady = Boolean(overview?.readyForGoLive);
  const setupActivated = Boolean(overview?.setupActive || overview?.status === "ACTIVE");
  const currentStepReady = [companyReady, businessReady, chartReady, mappingFieldsReady && costCenterFieldsReady, openingPositionReady, openingBalanced, reviewReady, reviewReady][step] ?? false;
  const highestUnlockedStep = Math.max(0, Math.min(7, overview?.highestUnlockedStep ?? 0));
  useEffect(() => {
    if (step > highestUnlockedStep) setStep(highestUnlockedStep);
  }, [highestUnlockedStep, step]);
  const currentStepHint = [
    "Enter all company identity, base currency, financial year and GST compliance fields. VERIFIED GST requires TIN and attached GST registration certificate.",
    "Select a business type. If Other is selected, enter the manual business type. Accounting and inventory methods are fixed.",
    "Import or create the Chart of Accounts before continuing.",
    "Complete every required Easynet-style account link and Cost Center link.",
    "Choose opening mode and opening date.",
    "Validate opening balances before review.",
    "Complete every readiness control before Go Live.",
    "",
  ][step];
  const next = async () => {
    if (!currentStepReady) {
      setError(currentStepHint || "Complete the current step before continuing.");
      return;
    }
    if (step <= 4) {
      const updated = await save();
      if (!updated) return;
      if (step === 3 && !updated.checks.mappings) {
        setError("Default account mappings are not valid yet. Use active ledger accounts with the correct account type.");
        return;
      }
    }
    if (step === 6) {
      const updated = await saveReview();
      if (!updated) return;
    }
    setStep((current) => Math.min(7, current + 1));
  };
  const modify = async () => {
    if (!currentStepReady) {
      setError(currentStepHint || "Complete this step before modifying.");
      return;
    }
    if (step <= 4) {
      const updated = await save();
      if (!updated) return;
      setEditMode(false);
      setMessage("Modified Successfully.");
      return;
    }
    if (step === 5) {
      const valid = await validate();
      if (valid) {
        setEditMode(false);
        setMessage("Modified Successfully.");
      }
      return;
    }
    if (step === 6) {
      const updated = await saveReview();
      if (!updated) return;
      setEditMode(false);
      setMessage("Modified Successfully.");
      return;
    }
    setEditMode(false);
    setMessage("Modified Successfully.");
  };
  const previous = () => setStep((current) => Math.max(0, current - 1));
  const readinessItems = [
    ["Company identity", overview?.checks.company],
    ["Chart of Accounts", overview?.checks.chartOfAccounts],
    ["Mandatory account mappings", overview?.checks.mappings],
    ["Opening balance control", overview?.checks.openingValidated],
  ] as const;

  return <div className="page-stack">
    <section className="page-header"><div><span className="badge">First-time accounting setup</span><h1>Fresh Company Setup Wizard</h1><p>Configure the accounting foundation before operational documents are allowed. Setup saves are configuration-only; posting happens explicitly in the opening step.</p></div><span className={`coa-status-pill ${overview?.readyForGoLive ? "valid" : "invalid"}`}>{overview?.status || "NEW INSTALLATION"}</span></section>
    {(error || message) && <section className={error ? "warning-panel" : "panel"}><strong>{error ? "Action required" : "Saved"}</strong><p className="small">{error || message}</p></section>}
    <section className="panel">
      <div className="form-title-row">
        <div className="button-row" style={{ flexWrap: "wrap" }}>{steps.map((label, index) => {
          const locked = index > highestUnlockedStep;
          return <button key={label} type="button" className={index === step ? "" : "secondary-btn"} onClick={() => setStep(index)} disabled={busy || locked} title={locked ? "Complete and save previous steps first." : undefined}>{index + 1}. {label}</button>;
        })}</div>
        {setupActivated && !editMode && <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setEditMode(true); setStep(0); setError(""); setMessage("Edit mode enabled. Review any step and click Modify to save changes."); }}>Edit existing accounting system</button>}
        {setupActivated && editMode && <span className="coa-status-pill valid">EDIT MODE</span>}
      </div>
      <div className="small" style={{ marginTop: 12 }}>Step {step + 1} of {steps.length}. Next steps unlock only after the previous setup data is complete and saved.</div>
    </section>

    {step === 0 && <section className="panel form-grid"><h2 className="form-wide">1. Company identity</h2><label>Company name<input value={config.companyName} onChange={(event) => patch("companyName", event.target.value)} placeholder="Easynet IT Solutions Limited" required /></label><label>Short name<input value={config.companyShortName} onChange={(event) => patch("companyShortName", event.target.value)} placeholder="Easynet" required /></label><label>Country<input value={config.country} onChange={(event) => patch("country", event.target.value)} required /></label><label>Base Operating Currency<select value={config.baseCurrency} onChange={(event) => patch("baseCurrency", event.target.value)} required><option>PGK</option><option>USD</option><option>AUD</option><option>NZD</option></select></label><label>Company registration no.<input value={config.registrationNo} onChange={(event) => patch("registrationNo", event.target.value)} required /></label><label className="form-wide">Active Financial Year Period (Papua New Guinea)<select value={config.financialYearPeriod} onChange={(event) => patch("financialYearPeriod", event.target.value)} required><option value="">Select financial year period</option>{PNG_FINANCIAL_YEAR_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}</select><span className="small">PNG statutory financial year follows 01 January to 31 December. This value links to Finance & ERP Configuration in read-only mode.</span></label><div className="form-wide settings-section-title"><h3>PNG GST & IRC Compliance</h3><p className="small">These GST values link to Finance & ERP Configuration in read-only mode.</p></div><label>GST Control Status<select value={config.gstStatus} onChange={(event) => patch("gstStatus", event.target.value)} required><option value="">Select GST control status</option>{GST_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label>GST / IRC Tax Identification Number (TIN){config.gstStatus === "VERIFIED" ? " *" : ""}<input value={config.gstNumber} onChange={(event) => patch("gstNumber", event.target.value)} placeholder="e.g. TIN-50012389" required={config.gstStatus === "VERIFIED"} /></label>{config.gstStatus === "VERIFIED" && <div className="form-wide settings-doc-box"><div className="form-title-row"><strong>Attach GST Registration Certificate *</strong>{config.gstEvidenceDocName ? <span className="coa-status-pill valid">Document attached</span> : <span className="coa-status-pill invalid">Required</span>}</div>{config.gstEvidenceDocName && <div className="settings-doc-active-chip" style={{ marginTop: 8 }}><span>📄 <strong>{config.gstEvidenceDocName}</strong> (Type: GST_REGISTRATION)</span><button type="button" className="coa-action-pill" style={{ background: "#fee2e2", color: "#991b1b" }} onClick={() => { setGstCertificateFile(null); patch("gstEvidenceDocName", ""); }}>Remove</button></div>}<input type="file" accept=".pdf,image/png,image/jpeg" required={!config.gstEvidenceDocName} onChange={(event) => { const file = event.target.files?.[0] || null; setGstCertificateFile(file); patch("gstEvidenceDocName", file?.name || ""); }} /><p className="small">Attach the formal PNG IRC GST registration certificate. Selected file metadata is retained as setup evidence and linked to Finance & ERP Configuration.</p>{gstCertificateFile && <p className="small">Selected: {gstCertificateFile.name} ({(gstCertificateFile.size / 1024).toFixed(1)} KB)</p>}</div>}<label className="form-wide">Evidence / Audit Reference Note<textarea value={config.gstEvidenceNote} onChange={(event) => patch("gstEvidenceNote", event.target.value)} rows={2} placeholder="Optional certificate reference, issue date, exemption reason, or statutory note." /><span className="small">For VERIFIED status, the attached certificate is mandatory; this note is optional extra audit context.</span></label></section>}
    {step === 1 && <section className="panel form-grid"><h2 className="form-wide">2. Business & accounting method</h2><label>Business type<select value={config.businessType} onChange={(event) => patch("businessType", event.target.value)} required><option value="IT_TECHNOLOGY">IT / Technology</option><option value="SERVICE">Service business</option><option value="TRADING">Trading / retail</option><option value="WHOLESALE">Wholesale</option><option value="MANUFACTURING">Manufacturing</option><option value="CONSTRUCTION">Construction</option><option value="PROFESSIONAL_SERVICES">Professional services</option><option value="OTHER">Other</option></select></label>{config.businessType === "OTHER" && <label>Manual business type<input value={config.customBusinessType} onChange={(event) => patch("customBusinessType", event.target.value)} placeholder="Type your business type" required /></label>}<label>Accounting method<input value={accountingMethodLabel} readOnly aria-readonly="true" required /></label><label>Inventory accounting<input value={inventoryMethodLabel} readOnly aria-readonly="true" required /></label><div className="form-wide conversion-box"><strong>Business-language posting</strong><p className="small">Users enter “received a loan”, “sold an item”, or “paid a supplier”. The accounting rule layer generates balanced debit/credit lines automatically.</p></div></section>}
    {step === 2 && <section className="panel">
      <h2>3. Chart of Accounts</h2>
      <p className="small">Choose one setup path. Existing businesses can import their own Chart of Accounts using the official template. New users without a COA can create the standard Easynet COA tree.</p>
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card"><div className="label">Active accounts</div><div className="value">{overview?.metrics.coaCount ?? "—"}</div></div>
        <div className="card"><div className="label">Structure</div><div className="value small-value">{overview?.checks.chartOfAccounts ? "READY" : "REQUIRED"}</div></div>
      </div>
      <div className="form-grid" style={{ marginTop: 18 }}>
        <div className="form-wide settings-section-title">
          <h3>Section 1 — Import existing Chart of Accounts</h3>
          <p className="small">Use this when the company already has a COA. Download the template, arrange the file in the same columns, then upload. If the required format/columns or account values do not match, the import will be blocked and the user must correct the file first.</p>
        </div>
        <div className="form-wide button-row">
          <a className="secondary-btn" href="/api/ui/accounts/import?format=csv">Download CSV template</a>
          <a className="secondary-btn" href="/api/ui/accounts/import?format=xlsx">Download Excel template</a>
        </div>
        <label className="form-wide">Import Chart of Accounts file<input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required disabled={coaImporting || busy || standardCoaCreating} onChange={(event) => setCoaFile(event.target.files?.[0] || null)} /></label>
        <div className="form-wide button-row">
          <button type="button" onClick={() => void importChartOfAccounts()} disabled={coaImporting || busy || standardCoaCreating || !coaFile}>{coaImporting ? "Importing…" : "Import Chart of Accounts"}</button>
          <button type="button" className="secondary-btn" onClick={() => void loadSetupAccounts()} disabled={coaLoading || coaImporting || busy || standardCoaCreating || !chartReady}>{coaLoading ? "Loading COA…" : "Refresh COA preview"}</button>
        </div>
        <p className="small form-wide">Supported files: CSV, XLS, XLSX. Required template columns: Account Code, Account Name, Account Type, Parent Code, Normal Balance, Currency, Description, Status.</p>
        <div className="form-wide settings-section-title">
          <h3>Section 2 — Create standard Chart of Accounts</h3>
          <p className="small">Use this when the company does not have a COA. The system creates a standard hierarchy: Application of Funds (Assets), Source of Funds (Liabilities), Equity, Income, and Expenses with ledger/control accounts below.</p>
        </div>
        <div className="form-wide button-row">
          <button type="button" onClick={() => void createStandardCoa()} disabled={busy || coaImporting || standardCoaCreating || (overview?.metrics.coaCount ?? 0) > 0}>{standardCoaCreating ? "Creating standard COA…" : "Create standard COA"}</button>
        </div>
        {(overview?.metrics.coaCount ?? 0) > 0 && <p className="small form-wide">Standard COA creation is available only when Chart of Accounts is empty. If you need a fresh standard COA, delete full system master data first.</p>}
      </div>
      {chartReady && <div className="table-wrap" style={{ marginTop: 18 }}><div className="form-title-row"><div><h3>Chart of Accounts preview</h3><p className="small">Use Tree view to verify parent/child structure, or List view to audit every imported/generated ledger/group account.</p></div><div className="button-row"><button type="button" className={coaView === "tree" ? "" : "secondary-btn"} onClick={() => setCoaView("tree")}>Tree view</button><button type="button" className={coaView === "list" ? "" : "secondary-btn"} onClick={() => setCoaView("list")}>List view</button></div></div>{coaLoading ? <p className="small" style={{ marginTop: 12 }}>Loading Chart of Accounts…</p> : setupAccounts.length ? <table className="data-table" style={{ marginTop: 16 }}><thead>{coaView === "tree" ? <tr><th>Account hierarchy</th><th>Type</th><th>Status</th><th>Posting mode</th></tr> : <tr><th>Code</th><th>Account name</th><th>Type</th><th>Parent</th><th>Normal balance</th><th>Status</th><th>Posting mode</th></tr>}</thead><tbody>{coaView === "tree" ? renderAccountTreeRows(coaTree) : setupAccounts.map((account) => <tr key={account.accountId}><td><strong>{account.accountCode}</strong></td><td>{account.accountName}</td><td>{account.accountType.replaceAll("_", " ")}</td><td>{account.parentAccount || "—"}</td><td>{account.normalBalance || "—"}</td><td><span className={`coa-status-pill ${account.active ? "valid" : "invalid"}`}>{account.active ? "Active" : "Inactive"}</span></td><td>{account.isGroup ? "Group" : "Ledger"}</td></tr>)}</tbody></table> : <p className="small" style={{ marginTop: 12 }}>No account rows loaded yet. Import a formatted file or create the standard COA.</p>}</div>}
    </section>}
    {step === 3 && <section className="panel form-grid">
      <div className="form-wide form-title-row">
        <div>
          <h2>4. Easynet-style Accounts & Stock Settings</h2>
          <p className="small">These linked defaults drive invoices, payments, inventory valuation, COGS, payroll, opening balances and financial statements.</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={() => void loadSetupAccounts()} disabled={busy || coaLoading || aiSuggesting || !chartReady}>{coaLoading ? "Loading accounts…" : "Refresh account list"}</button>
          <button type="button" onClick={() => void suggestMappingAccounts()} disabled={busy || coaLoading || aiSuggesting || !chartReady}>{aiSuggesting ? "AI suggesting…" : "AI Suggested Account Selection"}</button>
        </div>
      </div>
      <div className="form-wide warning-panel">
        <strong>Manual linked setup required</strong>
        <p className="small">The system does not auto-set these accounts. Search by account number or account name and choose the correct active ledger account from your imported Chart of Accounts. Group accounts are blocked.</p>
      </div>
      {renderQuickAccountCreator()}
      {renderQuickCostCenterCreator()}
      {Object.keys(mappingSuggestionNotes).length > 0 && <div className="form-wide conversion-box">
        <strong>AI suggestion result</strong>
        {mappingAccountFields.map((field) => mappingSuggestionNotes[field.configKey] ? <p key={field.settingKey} className="small">{mappingSuggestionNotes[field.configKey]}</p> : null)}
      </div>}
      <div className="form-wide settings-section-title">
        <h3>Accounts Settings</h3>
        <p className="small">Easynet-style company default accounts. All required fields must link to active ledger accounts with the correct account type.</p>
      </div>
      {ERP_ACCOUNT_SETTING_FIELDS.map(renderMappingAccountField)}
      <div className="form-wide settings-section-title">
        <h3>Stock Settings</h3>
        <p className="small">Perpetual inventory is locked on for Easynet Finance AI. These accounts control inventory asset, GRNI, stock adjustment and valuation posting.</p>
      </div>
      <label>Enable Perpetual Inventory<input type="checkbox" checked={config.enablePerpetualInventory} onChange={(event) => patchBoolean("enablePerpetualInventory", event.target.checked)} required disabled aria-readonly="true" /><span className="small">Read-only. System always uses perpetual inventory for stock accounting.</span></label>
      <label>Enable Perpetual Inventory For Non Stock Items<input type="checkbox" checked={config.enablePerpetualInventoryForNonStockItems} onChange={(event) => patchBoolean("enablePerpetualInventoryForNonStockItems", event.target.checked)} disabled aria-readonly="true" /><span className="small">Read-only. Non-stock items do not create stock ledger valuation entries.</span></label>
      {ERP_STOCK_SETTING_FIELDS.map(renderMappingAccountField)}
      <div className="form-wide settings-section-title">
        <h3>Fixed Asset Depreciation Settings</h3>
        <p className="small">Optional defaults used when fixed asset depreciation/disposal flows are enabled.</p>
      </div>
      {ERP_FIXED_ASSET_SETTING_FIELDS.map(renderMappingAccountField)}
      <div className="form-wide settings-section-title">
        <h3>Cost Center & Terms Defaults</h3>
        <p className="small">Cost Centers are real master records now. Revenue, Expense and COGS journal lines use these defaults for reporting.</p>
      </div>
      <div className="form-wide button-row">
        <button type="button" className="secondary-btn" onClick={() => void loadCostCenters()} disabled={busy || costCenterLoading}>{costCenterLoading ? "Loading Cost Centers…" : "Refresh Cost Centers"}</button>
        <Link className="secondary-btn" href="/cost-centers">Manage Cost Centers</Link>
      </div>
      {ERP_COST_CENTER_SETTING_FIELDS.map(renderCostCenterSettingField)}
      {ERP_TEXT_SETTING_FIELDS.map(renderTextSettingField)}
    </section>}
    {step === 4 && <section className="panel form-grid">
      <h2 className="form-wide">5. Opening position</h2>
      <label>Opening mode<select value={config.openingMode} onChange={(event) => patch("openingMode", event.target.value)} required><option value="NEW_BUSINESS">New business — zero opening balances</option><option value="EXISTING_BUSINESS">Existing business — migrate balances</option></select></label>
      <label>Go-live / opening date<input type="date" value={config.openingDate} onChange={(event) => patch("openingDate", event.target.value)} required /></label>
      {config.openingMode === "NEW_BUSINESS"
        ? <div className="form-wide conversion-box"><strong>New business selected</strong><p className="small">No migration CTA is required. Continue with zero opening balances after entering the go-live / opening date.</p></div>
        : <><div className="form-wide warning-panel"><strong>Existing business migration required</strong><p className="small">First save this step, then enter and validate ledger-level opening balances in Step 6. After Step 6 posts the opening control journal, AR/AP schedule upload will unlock in the migration centre.</p></div><div className="form-wide button-row">{existingBusinessMigrationReady ? <Link className="secondary-btn" href="/migration/opening-subledger">Open migration centre</Link> : <button type="button" className="secondary-btn" disabled>Migration centre unlocks after Step 6 balances</button>}</div></>}
    </section>}
    {step === 5 && <section className="panel table-wrap"><div className="form-title-row"><div><h2>6. Opening balance control</h2><p className="small">Enter ledger-level opening balances. The system blocks activation unless total debit equals total credit exactly.</p></div><span className={`coa-status-pill ${validation?.valid ? "valid" : "invalid"}`}>{validation ? (validation.valid ? "BALANCED" : "CORRECT REQUIRED") : "NOT VALIDATED"}</span></div><table className="data-table" style={{ marginTop: 16 }}><thead><tr><th>Account</th><th>Debit (PGK)</th><th>Credit (PGK)</th></tr></thead><tbody>{balances.map((row, index) => <tr key={row.accountCode}><td><strong>{row.label}</strong><div className="small">{row.accountCode}</div></td><td><input type="number" min="0" step="0.01" value={row.debit} onChange={(event) => updateBalance(index, "debit", event.target.value)} /></td><td><input type="number" min="0" step="0.01" value={row.credit} onChange={(event) => updateBalance(index, "credit", event.target.value)} /></td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{money(totals.debit)}</th><th>{money(totals.credit)}</th></tr></tfoot></table>{validation?.errors.length ? <div className="warning-panel" style={{ marginTop: 16 }}>{validation.errors.map((item) => <div key={item}>{item}</div>)}</div> : null}<div className="button-row" style={{ marginTop: 16 }}><button type="button" onClick={() => void validate()} disabled={busy}>{busy ? "Validating…" : "Validate opening balances"}</button></div></section>}
    {step === 6 && <section className="panel"><h2>7. Review & reconcile</h2><p className="small">Review the configuration before activation. No financial document is posted by this screen.</p><div className="table-wrap" style={{ marginTop: 16 }}><table className="data-table"><tbody><tr><th>Company</th><td>{config.companyName || "Not set"}</td></tr><tr><th>Base Operating Currency</th><td>{config.baseCurrency}</td></tr><tr><th>Active Financial Year Period</th><td>{config.financialYearPeriod || "Not set"}</td></tr><tr><th>GST control status</th><td>{config.gstStatus || "Not set"}</td></tr><tr><th>GST / IRC TIN</th><td>{config.gstNumber || "—"}</td></tr><tr><th>GST retained document</th><td>{config.gstEvidenceDocName || "—"}</td></tr><tr><th>Accounting / inventory</th><td>{accountingMethodLabel} · {inventoryMethodLabel}</td></tr><tr><th>COA</th><td>{overview?.metrics.coaCount ?? 0} active accounts</td></tr><tr><th>Opening control</th><td>{validation?.valid || overview?.openingValidated ? "Balanced" : "Not validated"}</td></tr></tbody></table></div></section>}
    {step === 7 && <section className="panel"><h2>8. Go live</h2><p className="small">Activation locks the setup state. Posted journals remain immutable; corrections use reversal entries.</p><div className="grid" style={{ marginTop: 16 }}><div className="card"><div className="label">Configuration</div><div className="value small-value">{overview?.configurationReady ? "PASS" : "REQUIRED"}</div></div><div className="card"><div className="label">Opening validation</div><div className="value small-value">{overview?.openingValidated ? "PASS" : "REQUIRED"}</div></div><div className="card"><div className="label">Decision</div><div className="value small-value">{overview?.readyForGoLive ? "READY" : "BLOCKED"}</div></div></div><div className="table-wrap" style={{ marginTop: 16 }}><table className="data-table"><thead><tr><th>Readiness control</th><th>Status</th></tr></thead><tbody>{readinessItems.map(([label, passed]) => <tr key={label}><td>{label}</td><td><span className={`coa-status-pill ${passed ? "valid" : "invalid"}`}>{passed ? "PASS" : "REQUIRED"}</span></td></tr>)}</tbody></table></div>{!overview?.readyForGoLive && <p className="small" style={{ marginTop: 12 }}>Complete every required control above.</p>}{setupActivated && <div className="conversion-box" style={{ marginTop: 16 }}><strong>Accounting system active</strong><p className="small">Successfully saved. System is ready to use. Use edit mode only when you need to update the existing accounting setup.</p></div>}<div className="button-row" style={{ marginTop: 16 }}>{setupActivated ? <button type="button" disabled>Accounting system active</button> : <button type="button" onClick={() => void activate()} disabled={busy || !overview?.readyForGoLive}>{busy ? "Saving…" : "Activate accounting system"}</button>}</div></section>}

    <section className="panel"><div className="button-row"><button type="button" className="secondary-btn" onClick={previous} disabled={busy || step === 0}>← Previous</button>{setupActivated && editMode ? <button type="button" onClick={() => void modify()} disabled={busy || !currentStepReady}>{busy ? "Modifying…" : "Modify"}</button> : !setupActivated && step < 7 && <button type="button" onClick={() => void next()} disabled={busy || !currentStepReady}>{busy ? "Saving…" : "Save & continue →"}</button>}</div>{!setupActivated && step < 7 && !currentStepReady && <div className="small" style={{ marginTop: 10 }}>{currentStepHint}</div>}{setupActivated && editMode && !currentStepReady && <div className="small" style={{ marginTop: 10 }}>{currentStepHint}</div>}</section>
  </div>;
}
