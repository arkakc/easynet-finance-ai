import { findRecords, listTable, postJournalRecord } from "@/lib/backend/apps-script";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { resolveCostCenterValue } from "@/lib/accounting/cost-centers";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

export type PostingLine = {
  accountId: string;
  debit?: number;
  credit?: number;
  customerId?: string;
  supplierId?: string;
  projectId?: string;
  taxCode?: string;
  costCenter?: string;
  description?: string;
};

export type PostingRequest = {
  postingDate: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  reference?: string;
  projectId?: string;
  createdBy?: string;
  approvedBy?: string;
  lines: PostingLine[];
};

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function applyDefaultCostCenters(lines: PostingLine[]) {
  const [settings, accounts] = await Promise.all([
    listTable<{ key: string; value: string }>("Settings", 500, 0),
    listTable<{ accountId?: string; accountCode?: string; accountType?: string; type?: string }>("Accounts", 500, 0),
  ]);
  const setting = new Map(settings.rows.map((row) => [String(row.key || ""), String(row.value || "")]));
  const defaultCostCenter = await resolveCostCenterValue(setting.get("default_cost_center") || "Main", "Main");
  const roundOffCostCenter = await resolveCostCenterValue(setting.get("round_off_cost_center") || defaultCostCenter, defaultCostCenter);
  const accountByRef = new Map<string, { accountType?: string; type?: string }>();
  for (const account of accounts.rows) {
    const id = String(account.accountId || "");
    const code = String(account.accountCode || "").replace(/^ACC-/i, "");
    if (id) accountByRef.set(id.toLowerCase(), account);
    if (code) {
      accountByRef.set(code.toLowerCase(), account);
      accountByRef.set(`acc-${code}`.toLowerCase(), account);
    }
  }
  const isProfitAndLoss = (line: PostingLine) => {
    const ref = String(line.accountId || "").toLowerCase();
    const account = accountByRef.get(ref) || accountByRef.get(ref.replace(/^acc-/i, ""));
    const type = String(account?.accountType || account?.type || "").toLowerCase();
    return ["revenue", "income", "expense", "cost of goods sold", "cogs"].some((term) => type.includes(term));
  };
  return lines.map((line) => {
    if (String(line.costCenter || "").trim()) return line;
    if (!isProfitAndLoss(line)) return line;
    const description = String(line.description || "").toLowerCase();
    return { ...line, costCenter: description.includes("round") ? roundOffCostCenter : defaultCostCenter };
  });
}

export function validateBalancedPosting(lines: PostingLine[]) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("A journal requires at least two lines");
  let debit = 0;
  let credit = 0;

  for (const line of lines) {
    const d = Number(line.debit || 0);
    const c = Number(line.credit || 0);
    if (d < 0 || c < 0) throw new Error("Debit and credit cannot be negative");
    if (d > 0 && c > 0) throw new Error("A journal line cannot contain both debit and credit");
    if (d === 0 && c === 0) throw new Error("A journal line must contain a debit or credit amount");
    debit += d;
    credit += c;
  }

  debit = round2(debit);
  credit = round2(credit);
  if (debit !== credit) throw new Error(`Journal is not balanced: debit ${debit.toFixed(2)} vs credit ${credit.toFixed(2)}`);
  return { debit, credit };
}

export async function assertAccountsExist(lines: PostingLine[]) {
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const result = await listTable<{
    accountId: string;
    parentAccount: string;
    active: boolean | string;
  }>("Accounts", 500, 0);

  const active = new Set(
    result.rows
      .filter((row) => String(row.active).toLowerCase() !== "false")
      .map((row) => row.accountId),
  );
  const parentIds = new Set(
    result.rows.map((row) => String(row.parentAccount || "")).filter(Boolean),
  );

  const missing = accountIds.filter((id) => !active.has(id));
  if (missing.length) throw new Error(`Missing or inactive accounts: ${missing.join(", ")}`);

  const parents = accountIds.filter((id) => parentIds.has(id));
  if (parents.length) throw new Error(`Posting to parent/control accounts is blocked: ${parents.join(", ")}`);
}

export async function postJournal(request: PostingRequest) {
  const linesWithCostCenters = await applyDefaultCostCenters(request.lines);
  validateBalancedPosting(linesWithCostCenters);
  await assertAccountsExist(linesWithCostCenters);

  const lock = await findRecords<{ key: string; value: string }>("Settings", { key: "posting_lock_date" }, 1);
  const lockDate = String(lock.rows[0]?.value || "").trim();
  if (lockDate && /^\d{4}-\d{2}-\d{2}$/.test(lockDate) && request.postingDate.slice(0, 10) <= lockDate) {
    throw new Error(`Financial period is locked through ${lockDate}. Post a reversal or ask an authorised user to reopen the period.`);
  }

  const existing = await findRecords<{ journalId: string }>(
    "JournalHeaders",
    { documentType: request.documentType, documentId: request.documentId },
    5,
  );
  if (existing.rows.length) throw new Error("This document already has a posted journal");

  const journalId = documentSeriesId("Journal");
  const now = new Date().toISOString();

  const header = {
    journalId,
    postingDate: request.postingDate,
    documentType: request.documentType,
    documentId: request.documentId,
    documentNumber: request.documentNumber,
    reference: request.reference || "",
    projectId: request.projectId || "",
    status: "POSTED",
    reversalOfJournalId: "",
    createdBy: request.createdBy || "finance-ui",
    approvedBy: request.approvedBy || "Finance Controller",
    createdAt: now,
    postedAt: now,
  };

  const journalLines = linesWithCostCenters.map((line, index) => ({
    journalLineId: `${journalId}-${String(index + 1).padStart(3, "0")}`,
    journalId,
    lineNo: index + 1,
    accountId: line.accountId,
    customerId: line.customerId || "",
    supplierId: line.supplierId || "",
    projectId: line.projectId || request.projectId || "",
    debit: round2(Number(line.debit || 0)),
    credit: round2(Number(line.credit || 0)),
    taxCode: line.taxCode || "",
    costCenter: line.costCenter || "",
    description: line.description || request.reference || request.documentNumber,
    createdAt: now,
  }));

  await postJournalRecord({
    header,
    lines: journalLines,
    actor: request.createdBy || "finance-ui",
  });

  return { journalId, header, lines: journalLines };
}

export function salesInvoicePosting(input: {
  total: number;
  net: number;
  gst: number;
  customerId: string;
  projectId?: string;
  revenueAccountId: string;
}) {
  return salesInvoicePostingByLines({
    total: input.total,
    gst: input.gst,
    customerId: input.customerId,
    projectId: input.projectId,
    revenueLines: [{ accountId: input.revenueAccountId, amount: input.net }],
  });
}

export function supplierBillPosting(input: {
  total: number;
  net: number;
  gst: number;
  supplierId: string;
  projectId?: string;
  costAccountId: string;
}) {
  return supplierBillPostingByLines({
    total: input.total,
    gst: input.gst,
    supplierId: input.supplierId,
    projectId: input.projectId,
    costLines: [{ accountId: input.costAccountId, amount: input.net }],
  });
}

export function salesInvoicePostingByLines(input: {
  total: number;
  gst: number;
  customerId: string;
  projectId?: string;
  revenueLines: Array<{ accountId: string; amount: number; description?: string; deferred?: boolean }>;
  cogsLines?: Array<{ accountId: string; amount: number; description?: string }>;
  receivableAccountId?: string;
  deferredRevenueAccountId?: string;
  inventoryAccountId?: string;
}) {
  const lines: PostingLine[] = [
    {
      accountId: input.receivableAccountId || INITIAL_ACCOUNT_IDS.accountsReceivable,
      debit: input.total,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Accounts receivable",
    },
  ];

  const immediateRevenue = new Map<string, number>();
  let deferredRevenue = 0;
  for (const line of input.revenueLines) {
    const amount = round2(Number(line.amount || 0));
    if (!(amount > 0)) continue;
    if (line.deferred) {
      deferredRevenue = round2(deferredRevenue + amount);
    } else {
      immediateRevenue.set(line.accountId, round2((immediateRevenue.get(line.accountId) || 0) + amount));
    }
  }

  for (const [accountId, amount] of immediateRevenue.entries()) {
    lines.push({
      accountId,
      credit: amount,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Sales revenue",
    });
  }

  if (deferredRevenue > 0) {
    lines.push({
      accountId: input.deferredRevenueAccountId || INITIAL_ACCOUNT_IDS.customerAdvances,
      credit: deferredRevenue,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Deferred revenue / contract liability",
    });
  }

  if (input.gst) {
    lines.push({
      accountId: INITIAL_ACCOUNT_IDS.gstPayable,
      credit: input.gst,
      customerId: input.customerId,
      projectId: input.projectId,
      taxCode: "GST",
      description: "Output GST",
    });
  }

  const cogsGrouped = new Map<string, number>();
  for (const line of input.cogsLines || []) {
    const amount = round2(Number(line.amount || 0));
    if (amount > 0) cogsGrouped.set(line.accountId, round2((cogsGrouped.get(line.accountId) || 0) + amount));
  }
  let totalCogs = 0;
  for (const [accountId, amount] of cogsGrouped.entries()) {
    totalCogs = round2(totalCogs + amount);
    lines.push({
      accountId,
      debit: amount,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Cost of goods sold",
    });
  }
  if (totalCogs > 0) {
    lines.push({
      accountId: input.inventoryAccountId || INITIAL_ACCOUNT_IDS.inventory,
      credit: totalCogs,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Inventory issued to customer",
    });
  }

  validateBalancedPosting(lines);
  return lines;
}

export function supplierBillPostingByLines(input: {
  total: number;
  gst: number;
  supplierId: string;
  projectId?: string;
  costLines: Array<{ accountId: string; amount: number; description?: string }>;
  payableAccountId?: string;
}) {
  const lines: PostingLine[] = [];
  const grouped = new Map<string, number>();
  for (const line of input.costLines) {
    grouped.set(line.accountId, round2((grouped.get(line.accountId) || 0) + Number(line.amount || 0)));
  }
  for (const [accountId, amount] of grouped.entries()) {
    if (amount > 0) {
      lines.push({
        accountId,
        debit: amount,
        supplierId: input.supplierId,
        projectId: input.projectId,
        description: "Supplier cost",
      });
    }
  }
  if (input.gst) {
    lines.push({
      accountId: INITIAL_ACCOUNT_IDS.inputGst,
      debit: input.gst,
      supplierId: input.supplierId,
      projectId: input.projectId,
      taxCode: "GST",
      description: "Input GST",
    });
  }
  lines.push({
    accountId: input.payableAccountId || INITIAL_ACCOUNT_IDS.accountsPayable,
    credit: input.total,
    supplierId: input.supplierId,
    projectId: input.projectId,
    description: "Accounts payable",
  });
  validateBalancedPosting(lines);
  return lines;
}

export function supplierBillPostingMixed(input: {
  total: number;
  gst: number;
  supplierId: string;
  projectId?: string;
  serviceCostLines: Array<{ accountId: string; amount: number; description?: string }>;
  stockLines: Array<{ invoiceAmount: number; receiptValue: number; description?: string }>;
  payableAccountId?: string;
  stockReceivedButNotBilledAccountId?: string;
  purchasePriceVarianceAccountId?: string;
}) {
  const lines: PostingLine[] = [];
  const serviceGrouped = new Map<string, number>();
  for (const line of input.serviceCostLines) {
    const amount = round2(Number(line.amount || 0));
    if (amount > 0) serviceGrouped.set(line.accountId, round2((serviceGrouped.get(line.accountId) || 0) + amount));
  }
  for (const [accountId, amount] of serviceGrouped.entries()) {
    lines.push({
      accountId,
      debit: amount,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Service / non-stock purchase cost",
    });
  }

  const receiptValue = round2(input.stockLines.reduce((sum, line) => sum + Number(line.receiptValue || 0), 0));
  const stockInvoiceValue = round2(input.stockLines.reduce((sum, line) => sum + Number(line.invoiceAmount || 0), 0));
  if (receiptValue > 0) {
    lines.push({
      accountId: input.stockReceivedButNotBilledAccountId || INITIAL_ACCOUNT_IDS.grni,
      debit: receiptValue,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Clear stock received but not billed",
    });
  }

  const purchasePriceVariance = round2(stockInvoiceValue - receiptValue);
  if (purchasePriceVariance > 0) {
    lines.push({
      accountId: input.purchasePriceVarianceAccountId || INITIAL_ACCOUNT_IDS.purchasePriceVariance,
      debit: purchasePriceVariance,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Purchase price variance",
    });
  } else if (purchasePriceVariance < 0) {
    lines.push({
      accountId: input.purchasePriceVarianceAccountId || INITIAL_ACCOUNT_IDS.purchasePriceVariance,
      credit: Math.abs(purchasePriceVariance),
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Purchase price variance",
    });
  }

  if (input.gst) {
    lines.push({
      accountId: INITIAL_ACCOUNT_IDS.inputGst,
      debit: input.gst,
      supplierId: input.supplierId,
      projectId: input.projectId,
      taxCode: "GST",
      description: "Input GST",
    });
  }

  lines.push({
    accountId: input.payableAccountId || INITIAL_ACCOUNT_IDS.accountsPayable,
    credit: input.total,
    supplierId: input.supplierId,
    projectId: input.projectId,
    description: "Accounts payable",
  });
  validateBalancedPosting(lines);
  return { lines, purchasePriceVariance, receiptValue, stockInvoiceValue };
}

export function purchaseReceiptPosting(input: {
  inventoryValue: number;
  supplierId?: string;
  projectId?: string;
  inventoryAccountId?: string;
  stockReceivedButNotBilledAccountId?: string;
}) {
  const value = round2(input.inventoryValue);
  const lines: PostingLine[] = [
    {
      accountId: input.inventoryAccountId || INITIAL_ACCOUNT_IDS.inventory,
      debit: value,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Inventory received",
    },
    {
      accountId: input.stockReceivedButNotBilledAccountId || INITIAL_ACCOUNT_IDS.grni,
      credit: value,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Stock received but not billed",
    },
  ];
  validateBalancedPosting(lines);
  return lines;
}

export function receiptPosting(input: {
  amount: number;
  customerId: string;
  projectId?: string;
  cashBankAccountId: string;
  advance?: boolean;
  receivableAccountId?: string;
  deferredRevenueAccountId?: string;
}) {
  return [
    { accountId: input.cashBankAccountId, debit: input.amount, customerId: input.customerId, projectId: input.projectId, description: input.advance ? "Customer advance receipt" : "Customer receipt" },
    { accountId: input.advance ? (input.deferredRevenueAccountId || INITIAL_ACCOUNT_IDS.customerAdvances) : (input.receivableAccountId || INITIAL_ACCOUNT_IDS.accountsReceivable), credit: input.amount, customerId: input.customerId, projectId: input.projectId, description: input.advance ? "Customer advance / unearned revenue" : "Settle accounts receivable" },
  ];
}

export function supplierPaymentPosting(input: {
  amount: number;
  supplierId: string;
  projectId?: string;
  cashBankAccountId: string;
  advance?: boolean;
  payableAccountId?: string;
  supplierAdvanceAccountId?: string;
}) {
  return [
    { accountId: input.advance ? (input.supplierAdvanceAccountId || INITIAL_ACCOUNT_IDS.supplierAdvances) : (input.payableAccountId || INITIAL_ACCOUNT_IDS.accountsPayable), debit: input.amount, supplierId: input.supplierId, projectId: input.projectId, description: input.advance ? "Supplier advance" : "Settle accounts payable" },
    { accountId: input.cashBankAccountId, credit: input.amount, supplierId: input.supplierId, projectId: input.projectId, description: input.advance ? "Supplier advance payment" : "Supplier payment" },
  ];
}

export function inventoryIssuePosting(input: {
  amount: number;
  costAccountId: string;
  projectId?: string;
  description?: string;
  inventoryAccountId?: string;
}) {
  const amount = round2(input.amount);
  return [
    { accountId: input.costAccountId, debit: amount, projectId: input.projectId, description: input.description || "Inventory issue / cost of goods sold" },
    { accountId: input.inventoryAccountId || INITIAL_ACCOUNT_IDS.inventory, credit: amount, projectId: input.projectId, description: "Inventory reduction" },
  ];
}

export function inventoryAdjustmentPosting(input: {
  amountDelta: number;
  projectId?: string;
  type: "LANDED_COST" | "REVALUATION" | "NRV_WRITEDOWN" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "RETURN_IN" | "RETURN_OUT" | "PROJECT_ISSUE";
  costAccountId?: string;
  inventoryAccountId?: string;
  stockAdjustmentAccountId?: string;
  expensesIncludedInValuationAccountId?: string;
}) {
  const delta = round2(input.amountDelta);
  if (!delta) throw new Error("Inventory adjustment amount cannot be zero");
  const inventoryAccountId = input.inventoryAccountId || INITIAL_ACCOUNT_IDS.inventory;
  const stockAdjustmentAccountId = input.stockAdjustmentAccountId || INITIAL_ACCOUNT_IDS.inventoryAdjustmentLoss;
  const valuationClearingAccountId = input.expensesIncludedInValuationAccountId || INITIAL_ACCOUNT_IDS.landedCostClearing;

  if (input.type === "LANDED_COST") {
    if (delta <= 0) throw new Error("Landed cost must increase inventory value");
    return [
      { accountId: inventoryAccountId, debit: delta, projectId: input.projectId, description: "Landed cost capitalized to inventory" },
      { accountId: valuationClearingAccountId, credit: delta, projectId: input.projectId, description: "Landed cost clearing" },
    ];
  }

  if (input.type === "NRV_WRITEDOWN") {
    if (delta >= 0) throw new Error("NRV write-down must reduce inventory value");
    const amount = Math.abs(delta);
    return [
      { accountId: stockAdjustmentAccountId, debit: amount, projectId: input.projectId, description: "NRV inventory write-down" },
      { accountId: inventoryAccountId, credit: amount, projectId: input.projectId, description: "Inventory write-down" },
    ];
  }

  if (input.type === "REVALUATION") {
    if (delta > 0) {
      return [
        { accountId: inventoryAccountId, debit: delta, projectId: input.projectId, description: "Inventory revaluation increase" },
        { accountId: INITIAL_ACCOUNT_IDS.inventoryRevaluationGain, credit: delta, projectId: input.projectId, description: "Inventory revaluation gain" },
      ];
    }
    const amount = Math.abs(delta);
    return [
      { accountId: stockAdjustmentAccountId, debit: amount, projectId: input.projectId, description: "Inventory revaluation loss" },
      { accountId: inventoryAccountId, credit: amount, projectId: input.projectId, description: "Inventory revaluation decrease" },
    ];
  }

  const accountId = input.costAccountId || stockAdjustmentAccountId;
  if (delta > 0) {
    return [
      { accountId: inventoryAccountId, debit: delta, projectId: input.projectId, description: "Inventory quantity/value increase" },
      { accountId: INITIAL_ACCOUNT_IDS.inventoryRevaluationGain, credit: delta, projectId: input.projectId, description: "Inventory adjustment gain" },
    ];
  }
  const amount = Math.abs(delta);
  return [
    { accountId, debit: amount, projectId: input.projectId, description: "Inventory issue / adjustment cost" },
    { accountId: inventoryAccountId, credit: amount, projectId: input.projectId, description: "Inventory quantity/value decrease" },
  ];
}

export function deferredRevenueRecognitionPosting(input: {
  amount: number;
  revenueAccountId: string;
  customerId?: string;
  projectId?: string;
}) {
  const amount = round2(input.amount);
  const lines: PostingLine[] = [
    {
      accountId: INITIAL_ACCOUNT_IDS.customerAdvances,
      debit: amount,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Release deferred revenue",
    },
    {
      accountId: input.revenueAccountId,
      credit: amount,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Recognized revenue",
    },
  ];
  validateBalancedPosting(lines);
  return lines;
}

export function expensePosting(input: {
  total: number;
  net: number;
  gst: number;
  supplierId?: string;
  projectId?: string;
  expenseAccountId: string;
  cashBankAccountId: string;
}) {
  const lines: PostingLine[] = [
    { accountId: input.expenseAccountId, debit: input.net, supplierId: input.supplierId, projectId: input.projectId, description: "Expense" },
  ];
  if (input.gst) lines.push({ accountId: INITIAL_ACCOUNT_IDS.inputGst, debit: input.gst, supplierId: input.supplierId, projectId: input.projectId, taxCode: "GST", description: "Input GST" });
  lines.push({ accountId: input.cashBankAccountId, credit: input.total, supplierId: input.supplierId, projectId: input.projectId, description: "Expense payment" });
  validateBalancedPosting(lines);
  return lines;
}
