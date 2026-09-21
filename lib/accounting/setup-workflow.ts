import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import {
  ALL_ERP_ACCOUNT_SETTING_FIELDS,
  ALL_ERP_SETTING_KEYS,
  DEFAULT_FINANCE_SETUP_SETTINGS,
  ERP_COST_CENTER_SETTING_FIELDS,
  ERP_TEXT_SETTING_FIELDS,
} from "@/lib/accounting/finance-settings";
import { validateCostCenterRefs } from "@/lib/accounting/cost-centers";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const SETUP_KEYS = [
  "setup_status",
  "setup_completed_step_index",
  "setup_version",
  "company_name",
  "company_short_name",
  "company_country",
  "company_registration_no",
  "base_currency",
  "financial_year_period",
  "gst_status",
  "gst_number",
  "company_tin",
  "gst_evidence_note",
  "gst_evidence_doc_name",
  "accounting_method",
  "inventory_method",
  "business_type",
  "business_type_other",
  "opening_mode",
  "opening_date",
  "default_receivable_account",
  "default_payable_account",
  "default_cash_account",
  "default_bank_account",
  "retained_earnings_account",
  "round_off_account",
  "exchange_gain_loss_account",
  ...ALL_ERP_SETTING_KEYS,
  "opening_validation_status",
  "opening_validation_difference",
  "opening_balance_entries",
] as const;

const LOCKED_ACCOUNTING_METHOD = "ACCRUAL" as const;
const LOCKED_INVENTORY_METHOD = "PERPETUAL" as const;
const DEFAULT_PNG_FINANCIAL_YEAR_PERIOD = "FY 2026 (01 Jan 2026 - 31 Dec 2026)";
export const SETUP_FINAL_STEP_INDEX = 7;
export type OpeningBalanceEntry = { accountCode: string; debit?: number; credit?: number; label?: string };
const SETUP_OPENING_SOURCE_DOC_ID = "SETUP_OPENING_BALANCES";

export const setupConfigSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  companyShortName: z.string().trim().min(1).max(60),
  country: z.string().trim().min(2).max(80).default("Papua New Guinea"),
  registrationNo: z.string().trim().min(1).max(80),
  baseCurrency: z.string().trim().regex(/^[A-Z]{3}$/).default("PGK"),
  financialYearPeriod: z.string().trim().min(1).max(80).default(DEFAULT_PNG_FINANCIAL_YEAR_PERIOD),
  gstStatus: z.enum(["UNVERIFIED", "REGISTERED", "VERIFIED", "NOT_REGISTERED", "EXEMPT"]).default("UNVERIFIED"),
  gstNumber: z.string().trim().max(80).optional().default(""),
  gstEvidenceNote: z.string().trim().max(500).optional().default(""),
  gstEvidenceDocName: z.string().trim().max(180).optional().default(""),
  accountingMethod: z.any().optional().transform(() => LOCKED_ACCOUNTING_METHOD),
  inventoryMethod: z.any().optional().transform(() => LOCKED_INVENTORY_METHOD),
  businessType: z.enum(["SERVICE", "TRADING", "WHOLESALE", "MANUFACTURING", "CONSTRUCTION", "IT_TECHNOLOGY", "PROFESSIONAL_SERVICES", "OTHER"]).default("IT_TECHNOLOGY"),
  customBusinessType: z.string().trim().max(120).optional().default(""),
  openingMode: z.enum(["NEW_BUSINESS", "EXISTING_BUSINESS"]).default("NEW_BUSINESS"),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).default(""),
  defaultReceivableAccount: z.string().trim().max(40).optional().default(""),
  defaultPayableAccount: z.string().trim().max(40).optional().default(""),
  defaultCashAccount: z.string().trim().max(40).optional().default(""),
  defaultBankAccount: z.string().trim().max(40).optional().default(""),
  retainedEarningsAccount: z.string().trim().max(40).optional().default(""),
  roundOffAccount: z.string().trim().max(40).optional().default(""),
  exchangeGainLossAccount: z.string().trim().max(40).optional().default(""),
  defaultEmployeeAdvanceAccount: z.string().trim().max(40).optional().default(""),
  defaultCostOfGoodsSoldAccount: z.string().trim().max(40).optional().default(""),
  defaultIncomeAccount: z.string().trim().max(40).optional().default(""),
  defaultDeferredRevenueAccount: z.string().trim().max(40).optional().default(""),
  defaultDeferredExpenseAccount: z.string().trim().max(40).optional().default(""),
  defaultPayrollPayableAccount: z.string().trim().max(40).optional().default(""),
  defaultExpenseClaimPayableAccount: z.string().trim().max(40).optional().default(""),
  defaultPaymentDiscountAccount: z.string().trim().max(40).optional().default(""),
  writeOffAccount: z.string().trim().max(40).optional().default(""),
  unrealizedExchangeGainLossAccount: z.string().trim().max(40).optional().default(""),
  unrealizedProfitLossAccount: z.string().trim().max(40).optional().default(""),
  defaultInventoryAccount: z.string().trim().max(40).optional().default(""),
  stockAdjustmentAccount: z.string().trim().max(40).optional().default(""),
  stockReceivedButNotBilledAccount: z.string().trim().max(40).optional().default(""),
  serviceReceivedButNotBilledAccount: z.string().trim().max(40).optional().default(""),
  expensesIncludedInValuationAccount: z.string().trim().max(40).optional().default(""),
  accumulatedDepreciationAccount: z.string().trim().max(40).optional().default(""),
  depreciationExpenseAccount: z.string().trim().max(40).optional().default(""),
  gainLossAccountOnAssetDisposal: z.string().trim().max(40).optional().default(""),
  capitalWorkInProgressAccount: z.string().trim().max(40).optional().default(""),
  assetReceivedButNotBilledAccount: z.string().trim().max(40).optional().default(""),
  expensesIncludedInAssetValuationAccount: z.string().trim().max(40).optional().default(""),
  roundOffCostCenter: z.string().trim().max(80).optional().default(DEFAULT_FINANCE_SETUP_SETTINGS.roundOffCostCenter),
  defaultCostCenter: z.string().trim().max(80).optional().default(DEFAULT_FINANCE_SETUP_SETTINGS.defaultCostCenter),
  assetDepreciationCostCenter: z.string().trim().max(80).optional().default(DEFAULT_FINANCE_SETUP_SETTINGS.assetDepreciationCostCenter),
  creditLimit: z.string().trim().max(40).optional().default(DEFAULT_FINANCE_SETUP_SETTINGS.creditLimit),
  enablePerpetualInventory: z.boolean().optional().default(true),
  enablePerpetualInventoryForNonStockItems: z.boolean().optional().default(false),
}).superRefine((config, context) => {
  if (config.businessType === "OTHER" && !config.customBusinessType.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Custom business type is required when Other is selected",
      path: ["customBusinessType"],
    });
  }
  if (config.gstStatus === "VERIFIED") {
    if (!config.gstNumber.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GST / IRC TIN is required when GST status is Verified",
        path: ["gstNumber"],
      });
    }
    if (!config.gstEvidenceDocName.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GST registration certificate document is required when GST status is Verified",
        path: ["gstEvidenceDocName"],
      });
    }
  }
});

export type SetupConfig = z.infer<typeof setupConfigSchema>;

const settingValue = (key: string, value: string, actor: string) => ({ key, value, updatedBy: actor, updatedAt: new Date() });

function clampSetupStepIndex(value: number) {
  if (!Number.isFinite(value)) return -1;
  return Math.max(-1, Math.min(SETUP_FINAL_STEP_INDEX, Math.trunc(value)));
}

function parseSetupStepIndex(value: string, fallback = -1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampSetupStepIndex(parsed) : fallback;
}

async function recordSetupStepComplete(client: DbClient, stepIndex: number, actorEmail: string) {
  const targetStep = clampSetupStepIndex(stepIndex);
  if (targetStep < 0) return targetStep;
  const existing = await client.globalSettings.findUnique({
    where: { key: "setup_completed_step_index" },
    select: { value: true },
  });
  const currentStep = parseSetupStepIndex(String(existing?.value ?? "-1"));
  const nextStep = Math.max(currentStep, targetStep);
  await client.globalSettings.upsert({
    where: { key: "setup_completed_step_index" },
    create: settingValue("setup_completed_step_index", String(nextStep), actorEmail),
    update: { value: String(nextStep), updatedBy: actorEmail, updatedAt: new Date() },
  });
  return nextStep;
}

function valueOf(settings: Map<string, { value: string | null; valueInt: number | null; valueDecimal: Prisma.Decimal | null; valueBool: boolean | null; valueJson: string | null }>, key: string, fallback = "") {
  const row = settings.get(key);
  if (!row) return fallback;
  if (row.value !== null) return row.value;
  if (row.valueBool !== null) return String(row.valueBool);
  if (row.valueInt !== null) return String(row.valueInt);
  if (row.valueDecimal !== null) return String(row.valueDecimal);
  return row.valueJson || fallback;
}

function parseOpeningBalanceEntries(value: string): OpeningBalanceEntry[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        accountCode: String(row.accountCode || "").trim(),
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0),
        label: String(row.label || "").trim(),
      };
    }).filter((entry) => entry.accountCode);
  } catch {
    return [];
  }
}

function normalizeMappingCode(value: string) {
  return String(value || "").split("—")[0].trim().replace(/^ACC-/i, "");
}

function allowedPrismaTypes(types: readonly string[]) {
  return types.flatMap((type) => type === "INCOME" ? ["REVENUE"] : [type]);
}

export async function getSetupOverview(client: DbClient = prisma) {
  const [rows, coaCount, customerCount, supplierCount, itemCount] = await Promise.all([
    client.globalSettings.findMany({ where: { key: { in: [...SETUP_KEYS] } } }),
    client.chartOfAccounts.count({ where: { isActive: true } }),
    client.customer.count({ where: { isActive: true } }),
    client.supplier.count({ where: { isActive: true } }),
    client.item.count({ where: { isActive: true } }),
  ]);
  const settings = new Map(rows.map((row) => [row.key, row]));
  const config = {
    companyName: valueOf(settings, "company_name"),
    companyShortName: valueOf(settings, "company_short_name"),
    country: valueOf(settings, "company_country", "Papua New Guinea"),
    registrationNo: valueOf(settings, "company_registration_no"),
    baseCurrency: valueOf(settings, "base_currency", "PGK"),
    financialYearPeriod: valueOf(settings, "financial_year_period", DEFAULT_PNG_FINANCIAL_YEAR_PERIOD),
    gstStatus: valueOf(settings, "gst_status", "UNVERIFIED"),
    gstNumber: valueOf(settings, "gst_number") || valueOf(settings, "company_tin"),
    gstEvidenceNote: valueOf(settings, "gst_evidence_note"),
    gstEvidenceDocName: valueOf(settings, "gst_evidence_doc_name"),
    accountingMethod: LOCKED_ACCOUNTING_METHOD,
    inventoryMethod: LOCKED_INVENTORY_METHOD,
    businessType: valueOf(settings, "business_type", "IT_TECHNOLOGY"),
    customBusinessType: valueOf(settings, "business_type_other"),
    openingMode: valueOf(settings, "opening_mode", "NEW_BUSINESS"),
    openingDate: valueOf(settings, "opening_date"),
    defaultReceivableAccount: valueOf(settings, "default_receivable_account"),
    defaultPayableAccount: valueOf(settings, "default_payable_account"),
    defaultCashAccount: valueOf(settings, "default_cash_account"),
    defaultBankAccount: valueOf(settings, "default_bank_account"),
    retainedEarningsAccount: valueOf(settings, "retained_earnings_account"),
    roundOffAccount: valueOf(settings, "round_off_account"),
    exchangeGainLossAccount: valueOf(settings, "exchange_gain_loss_account"),
    ...Object.fromEntries(ALL_ERP_ACCOUNT_SETTING_FIELDS.map((field) => [
      field.configKey,
      valueOf(settings, field.settingKey, String(DEFAULT_FINANCE_SETUP_SETTINGS[field.configKey] ?? "")),
    ])),
    ...Object.fromEntries(ERP_TEXT_SETTING_FIELDS.map((field) => [
      field.configKey,
      valueOf(settings, field.settingKey, String(DEFAULT_FINANCE_SETUP_SETTINGS[field.configKey] ?? "")),
    ])),
    ...Object.fromEntries(ERP_COST_CENTER_SETTING_FIELDS.map((field) => [
      field.configKey,
      valueOf(settings, field.settingKey, String(DEFAULT_FINANCE_SETUP_SETTINGS[field.configKey] ?? "")),
    ])),
    enablePerpetualInventory: valueOf(settings, "enable_perpetual_inventory", "true") !== "false",
    enablePerpetualInventoryForNonStockItems: valueOf(settings, "enable_perpetual_inventory_for_non_stock_items", "false") === "true",
  } as SetupConfig;
  const mappingCodes = ALL_ERP_ACCOUNT_SETTING_FIELDS
    .map((field) => normalizeMappingCode(String((config as Record<string, unknown>)[field.configKey] || "")))
    .filter(Boolean);
  const mappedAccounts = await client.chartOfAccounts.findMany({ where: { code: { in: mappingCodes }, isActive: true }, include: { children: { select: { id: true } } } });
  const accountByCode = new Map(mappedAccounts.map((account) => [account.code, account]));
  const mappingRules = ALL_ERP_ACCOUNT_SETTING_FIELDS.map((field) => ({
    code: String((config as Record<string, unknown>)[field.configKey] || ""),
    required: field.required,
    types: allowedPrismaTypes(field.allowedTypes),
  }));
  const mappingsValid = mappingRules.every(({ code, required, types }) => {
    if (!code.trim()) return !required;
    const account = accountByCode.get(normalizeMappingCode(code));
    return Boolean(account && types.includes(account.type) && account.children.length === 0);
  });
  const requiredAccountDefaultsReady = ALL_ERP_ACCOUNT_SETTING_FIELDS.every((field) => !field.required || Boolean(normalizeMappingCode(String((config as Record<string, unknown>)[field.configKey] || ""))));
  const costCenterValidation = await validateCostCenterRefs(ERP_COST_CENTER_SETTING_FIELDS.map((field) => ({
    key: field.label,
    value: String((config as Record<string, unknown>)[field.configKey] || ""),
    required: field.required,
  })));
  const costCentersValid = costCenterValidation.valid;
  const requiredCostCentersReady = ERP_COST_CENTER_SETTING_FIELDS.every((field) => !field.required || Boolean(String((config as Record<string, unknown>)[field.configKey] || "").trim()));
  const businessTypeReady = Boolean(config.businessType && (config.businessType !== "OTHER" || config.customBusinessType));
  const gstReady = Boolean(config.gstStatus && (config.gstStatus !== "VERIFIED" || (config.gstNumber && config.gstEvidenceDocName)));
  const configurationReady = Boolean(config.companyName && config.companyShortName && config.country && config.registrationNo && config.baseCurrency && config.financialYearPeriod && gstReady && businessTypeReady && config.openingMode && config.openingDate && requiredAccountDefaultsReady && requiredCostCentersReady && costCentersValid && mappingsValid);
  const openingValidated = valueOf(settings, "opening_validation_status") === "VALID";
  const openingBalanceEntries = parseOpeningBalanceEntries(valueOf(settings, "opening_balance_entries", "[]"));
  const rawStatus = valueOf(settings, "setup_status", configurationReady ? "CONFIGURATION" : "NEW_INSTALLATION").toUpperCase();
  const completedStepIndex = parseSetupStepIndex(valueOf(settings, "setup_completed_step_index", "-1"));
  const setupActive = rawStatus === "ACTIVE" && completedStepIndex >= SETUP_FINAL_STEP_INDEX;
  const status = setupActive ? "ACTIVE" : configurationReady ? "CONFIGURATION" : "NEW_INSTALLATION";
  const highestUnlockedStep = setupActive ? SETUP_FINAL_STEP_INDEX : Math.max(0, Math.min(SETUP_FINAL_STEP_INDEX, completedStepIndex + 1));
  return {
    status,
    completedStepIndex,
    highestUnlockedStep,
    setupActive,
    config,
    metrics: { coaCount, customerCount, supplierCount, itemCount },
    checks: {
      company: Boolean(config.companyName && config.companyShortName && config.country && config.registrationNo && config.baseCurrency && config.financialYearPeriod && gstReady),
      chartOfAccounts: coaCount > 0,
      masterData: customerCount + supplierCount + itemCount > 0,
      mappings: mappingsValid && costCentersValid,
      costCenters: costCentersValid,
      openingValidated,
    },
    configurationReady,
    openingValidated,
    openingBalanceEntries,
    readyForGoLive: configurationReady && coaCount > 0 && openingValidated,
  };
}

export async function saveSetupConfig(input: unknown, actorEmail: string, client: PrismaClient = prisma, completedStepIndex?: number) {
  const parsed = setupConfigSchema.safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "configuration").join(", ");
    throw new Error(`Required setup data is missing or invalid: ${fields}`);
  }
  const config = parsed.data;
  const costCenterValidation = await validateCostCenterRefs(ERP_COST_CENTER_SETTING_FIELDS.map((field) => ({
    key: field.label,
    value: String((config as Record<string, unknown>)[field.configKey] || ""),
    required: field.required,
  })));
  if (!costCenterValidation.valid) throw new Error(`Cost Center setup is invalid: ${costCenterValidation.errors.join("; ")}`);
  const currentSetupRows = await client.globalSettings.findMany({
    where: { key: { in: ["setup_status", "setup_completed_step_index"] } },
    select: { key: true, value: true },
  });
  const currentSetupSettings = new Map(currentSetupRows.map((row) => [row.key, row.value || ""]));
  const currentStatus = String(currentSetupSettings.get("setup_status") || "NEW_INSTALLATION").toUpperCase();
  const currentCompletedStep = parseSetupStepIndex(String(currentSetupSettings.get("setup_completed_step_index") || "-1"));
  const preserveActiveStatus = currentStatus === "ACTIVE" && currentCompletedStep >= SETUP_FINAL_STEP_INDEX;
  const actor = await client.user.findUnique({ where: { email: actorEmail.toLowerCase() }, select: { id: true } });
  if (!actor) throw new Error("Authenticated user record not found");
  const pairs: Record<string, string> = {
    setup_status: preserveActiveStatus ? "ACTIVE" : "CONFIGURATION",
    setup_version: "1",
    company_name: config.companyName,
    company_short_name: config.companyShortName,
    company_country: config.country,
    company_registration_no: config.registrationNo,
    base_currency: config.baseCurrency,
    currency: config.baseCurrency,
    financial_year_period: config.financialYearPeriod,
    fiscal_year_start: "01-01",
    gst_status: config.gstStatus,
    gst_number: config.gstNumber,
    company_tin: config.gstNumber,
    gst_evidence_note: config.gstEvidenceNote,
    gst_evidence_doc_name: config.gstEvidenceDocName,
    accounting_method: LOCKED_ACCOUNTING_METHOD,
    inventory_method: LOCKED_INVENTORY_METHOD,
    perpetual_inventory: "true",
    business_type: config.businessType,
    business_type_other: config.businessType === "OTHER" ? config.customBusinessType.trim() : "",
    opening_mode: config.openingMode,
    opening_date: config.openingDate || "",
    default_receivable_account: normalizeMappingCode(config.defaultReceivableAccount),
    default_payable_account: normalizeMappingCode(config.defaultPayableAccount),
    default_cash_account: normalizeMappingCode(config.defaultCashAccount),
    default_bank_account: normalizeMappingCode(config.defaultBankAccount),
    retained_earnings_account: normalizeMappingCode(config.retainedEarningsAccount),
    round_off_account: normalizeMappingCode(config.roundOffAccount),
    exchange_gain_loss_account: normalizeMappingCode(config.exchangeGainLossAccount),
  };
  for (const field of ALL_ERP_ACCOUNT_SETTING_FIELDS) {
    pairs[field.settingKey] = normalizeMappingCode(String((config as Record<string, unknown>)[field.configKey] || ""));
  }
  for (const field of ERP_TEXT_SETTING_FIELDS) {
    pairs[field.settingKey] = String((config as Record<string, unknown>)[field.configKey] || "").trim();
  }
  for (const field of ERP_COST_CENTER_SETTING_FIELDS) {
    pairs[field.settingKey] = String((config as Record<string, unknown>)[field.configKey] || "").split("—")[0].trim();
  }
  pairs.enable_perpetual_inventory = String(config.enablePerpetualInventory !== false);
  pairs.enable_perpetual_inventory_for_non_stock_items = String(config.enablePerpetualInventoryForNonStockItems === true);
  await client.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(pairs)) {
      await tx.globalSettings.upsert({ where: { key }, create: settingValue(key, value, actorEmail), update: { value, updatedBy: actorEmail, updatedAt: new Date() } });
    }
    if (config.gstStatus === "VERIFIED" && config.gstEvidenceDocName.trim()) {
      const existingDoc = await tx.document.findFirst({
        where: { documentType: "GST_REGISTRATION", name: config.gstEvidenceDocName.trim() },
        select: { id: true },
      });
      if (!existingDoc) {
        const safeName = config.gstEvidenceDocName.trim().replace(/[\\/:*?"<>|]/g, "-");
        await tx.document.create({
          data: {
            code: documentSeriesId("Document"),
            name: config.gstEvidenceDocName.trim(),
            type: "CERTIFICATE",
            documentType: "GST_REGISTRATION",
            fileUrl: `/documents/${safeName}`,
            status: "APPROVED",
            description: `Retained IRC GST Registration Certificate for ${config.gstNumber || config.companyName}`,
            createdBy: actor.id,
          },
        });
      }
    }
    if (typeof completedStepIndex === "number") await recordSetupStepComplete(tx, completedStepIndex, actorEmail);
    await tx.auditLog.create({ data: { action: "UPDATE", entityType: "ACCOUNTING_SETUP", entityCode: "SETUP", description: `Accounting setup configuration saved by ${actorEmail}`, changes: JSON.stringify(config), userId: actor.id } });
  });
  return getSetupOverview(client);
}

export async function markSetupStepComplete(stepIndex: number, actorEmail: string, client: PrismaClient = prisma) {
  await recordSetupStepComplete(client, stepIndex, actorEmail);
  return getSetupOverview(client);
}

export async function validateOpeningBalances(entries: OpeningBalanceEntry[], client: DbClient = prisma) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { valid: true, errors: [], totalDebit: 0, totalCredit: 0, difference: 0, lineCount: 0 };
  }
  const codes = [...new Set(entries.map((entry) => String(entry.accountCode || "").trim()).filter(Boolean))];
  const accounts = await client.chartOfAccounts.findMany({ where: { code: { in: codes }, isActive: true }, include: { children: { select: { id: true } } } });
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const errors: string[] = [];
  let debit = 0;
  let credit = 0;
  for (const [index, entry] of entries.entries()) {
    const code = String(entry.accountCode || "").trim();
    const account = byCode.get(code);
    const d = Number(entry.debit || 0);
    const c = Number(entry.credit || 0);
    if (!account) errors.push(`Line ${index + 1}: account ${code || "(blank)"} was not found or is inactive`);
    else if (account.children.length > 0) errors.push(`Line ${index + 1}: ${code} is a group account; select a ledger account`);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0 || (d > 0 && c > 0) || (d === 0 && c === 0)) errors.push(`Line ${index + 1}: enter either a positive debit or credit amount`);
    debit += d;
    credit += c;
  }
  const roundedDebit = Math.round((debit + Number.EPSILON) * 100) / 100;
  const roundedCredit = Math.round((credit + Number.EPSILON) * 100) / 100;
  const difference = Math.round((roundedDebit - roundedCredit + Number.EPSILON) * 100) / 100;
  if (Math.abs(difference) >= 0.01) errors.push(`Opening balances are not balanced: debit K${roundedDebit.toFixed(2)} vs credit K${roundedCredit.toFixed(2)}`);
  return { valid: errors.length === 0, errors, totalDebit: roundedDebit, totalCredit: roundedCredit, difference, lineCount: entries.length };
}

export async function postOpeningBalanceJournal(entries: OpeningBalanceEntry[], actorEmail: string, client: PrismaClient = prisma) {
  const openingEntries = entries.filter((entry) => Number(entry.debit || 0) > 0 || Number(entry.credit || 0) > 0);
  if (!openingEntries.length) return null;

  return client.$transaction(async (tx) => {
    const validation = await validateOpeningBalances(openingEntries, tx);
    if (!validation.valid) throw new Error(`Opening balance journal cannot be posted: ${validation.errors.join("; ")}`);

    const [actor, settingRows] = await Promise.all([
      tx.user.findUnique({ where: { email: actorEmail.toLowerCase() }, select: { id: true } }),
      tx.globalSettings.findMany({ where: { key: { in: ["opening_date", "base_currency", "currency"] } }, select: { key: true, value: true } }),
    ]);
    if (!actor) throw new Error("Authenticated user record not found");

    const settings = new Map(settingRows.map((row) => [row.key, row.value || ""]));
    const openingDate = String(settings.get("opening_date") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)) throw new Error("Opening date must be saved before posting opening balances");
    const currency = String(settings.get("base_currency") || settings.get("currency") || "PGK").trim() || "PGK";
    const codes = [...new Set(openingEntries.map((entry) => String(entry.accountCode || "").trim()).filter(Boolean))];
    const accounts = await tx.chartOfAccounts.findMany({ where: { code: { in: codes }, isActive: true }, include: { children: { select: { id: true } } } });
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));
    const missing = codes.filter((code) => {
      const account = accountByCode.get(code);
      return !account || account.children.length > 0;
    });
    if (missing.length) throw new Error(`Opening balance journal cannot use missing/group account(s): ${missing.join(", ")}`);

    const existing = await tx.journalHeader.findFirst({
      where: { sourceDocType: "OPENING", sourceDocId: SETUP_OPENING_SOURCE_DOC_ID },
      select: { id: true, code: true },
    });
    const date = new Date(`${openingDate}T00:00:00+10:00`);
    const now = new Date();
    const lineData = openingEntries.map((entry, index) => {
      const debit = Math.round(Number(entry.debit || 0) * 100) / 100;
      const credit = Math.round(Number(entry.credit || 0) * 100) / 100;
      return {
        lineNo: index + 1,
        accountId: accountByCode.get(String(entry.accountCode).trim())!.id,
        description: `Opening balance${entry.label ? ` - ${entry.label}` : ""}`,
        debit,
        credit,
        amount: Math.max(debit, credit),
        currency,
      };
    });

    if (existing) {
      await tx.journalLine.deleteMany({ where: { journalId: existing.id } });
      return tx.journalHeader.update({
        where: { id: existing.id },
        data: {
          date,
          description: "Opening balances from Fresh Company Setup Wizard",
          reference: "SETUP-WIZARD",
          status: "POSTED",
          currency,
          totalDebit: validation.totalDebit,
          totalCredit: validation.totalCredit,
          isBalanced: true,
          approvedBy: actorEmail,
          approvedAt: now,
          postedAt: now,
          lines: { create: lineData },
        },
        select: { id: true, code: true, totalDebit: true, totalCredit: true },
      });
    }

    return tx.journalHeader.create({
      data: {
        code: documentSeriesId("Opening Journal"),
        date,
        description: "Opening balances from Fresh Company Setup Wizard",
        reference: "SETUP-WIZARD",
        sourceDocType: "OPENING",
        sourceDocId: SETUP_OPENING_SOURCE_DOC_ID,
        status: "POSTED",
        currency,
        totalDebit: validation.totalDebit,
        totalCredit: validation.totalCredit,
        isBalanced: true,
        createdBy: actorEmail,
        approvedBy: actorEmail,
        approvedAt: now,
        postedAt: now,
        lines: { create: lineData },
      },
      select: { id: true, code: true, totalDebit: true, totalCredit: true },
    });
  });
}
