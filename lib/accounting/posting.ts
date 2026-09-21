import { findRecords, listTable, postJournalRecord } from "@/lib/backend/apps-script";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { resolveCostCenterValue } from "@/lib/accounting/cost-centers";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import {
  expensePosting,
  inventoryAdjustmentPosting,
  inventoryIssuePosting,
  purchaseReceiptPosting,
  roundPostingAmount,
  salesInvoicePostingByLines,
  supplierBillPostingByLines,
  supplierBillPostingMixed,
  validateBalancedPosting,
  type PostingLine,
} from "@/lib/accounting/posting-rules";

export {
  expensePosting,
  inventoryAdjustmentPosting,
  inventoryIssuePosting,
  purchaseReceiptPosting,
  salesInvoicePostingByLines,
  supplierBillPostingByLines,
  supplierBillPostingMixed,
  validateBalancedPosting,
} from "@/lib/accounting/posting-rules";
export type { PostingLine } from "@/lib/accounting/posting-rules";



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

const round2 = roundPostingAmount;

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
