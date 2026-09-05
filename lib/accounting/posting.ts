import { randomUUID } from "node:crypto";
import { findRecords, listTable, postJournalRecord } from "@/lib/backend/apps-script";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";

export type PostingLine = {
  accountId: string;
  debit?: number;
  credit?: number;
  customerId?: string;
  supplierId?: string;
  projectId?: string;
  taxCode?: string;
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
  validateBalancedPosting(request.lines);
  await assertAccountsExist(request.lines);

  const existing = await findRecords<{ journalId: string }>(
    "JournalHeaders",
    { documentType: request.documentType, documentId: request.documentId },
    5,
  );
  if (existing.rows.length) throw new Error("This document already has a posted journal");

  const journalId = `JRN-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
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

  const journalLines = request.lines.map((line, index) => ({
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
  const lines: PostingLine[] = [
    {
      accountId: INITIAL_ACCOUNT_IDS.accountsReceivable,
      debit: input.total,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Accounts receivable",
    },
    {
      accountId: input.revenueAccountId,
      credit: input.net,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Sales revenue",
    },
  ];
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
  return lines;
}

export function supplierBillPosting(input: {
  total: number;
  net: number;
  gst: number;
  supplierId: string;
  projectId?: string;
  costAccountId: string;
}) {
  const lines: PostingLine[] = [
    {
      accountId: input.costAccountId,
      debit: input.net,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Supplier cost",
    },
  ];
  if (input.gst) {
    lines.push({
      accountId: "ACC-1140",
      debit: input.gst,
      supplierId: input.supplierId,
      projectId: input.projectId,
      taxCode: "GST",
      description: "Input GST",
    });
  }
  lines.push({
    accountId: INITIAL_ACCOUNT_IDS.accountsPayable,
    credit: input.total,
    supplierId: input.supplierId,
    projectId: input.projectId,
    description: "Accounts payable",
  });
  return lines;
}

export function salesInvoicePostingByLines(input: {
  total: number;
  gst: number;
  customerId: string;
  projectId?: string;
  revenueLines: Array<{ accountId: string; amount: number; description?: string }>;
}) {
  const lines: PostingLine[] = [
    {
      accountId: INITIAL_ACCOUNT_IDS.accountsReceivable,
      debit: input.total,
      customerId: input.customerId,
      projectId: input.projectId,
      description: "Accounts receivable",
    },
  ];

  const grouped = new Map<string, number>();
  for (const line of input.revenueLines) {
    grouped.set(line.accountId, round2((grouped.get(line.accountId) || 0) + Number(line.amount || 0)));
  }
  for (const [accountId, amount] of grouped.entries()) {
    if (amount > 0) {
      lines.push({
        accountId,
        credit: amount,
        customerId: input.customerId,
        projectId: input.projectId,
        description: "Sales revenue",
      });
    }
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
  validateBalancedPosting(lines);
  return lines;
}

export function supplierBillPostingByLines(input: {
  total: number;
  gst: number;
  supplierId: string;
  projectId?: string;
  costLines: Array<{ accountId: string; amount: number; description?: string }>;
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
      accountId: "ACC-1140",
      debit: input.gst,
      supplierId: input.supplierId,
      projectId: input.projectId,
      taxCode: "GST",
      description: "Input GST",
    });
  }
  lines.push({
    accountId: INITIAL_ACCOUNT_IDS.accountsPayable,
    credit: input.total,
    supplierId: input.supplierId,
    projectId: input.projectId,
    description: "Accounts payable",
  });
  validateBalancedPosting(lines);
  return lines;
}

export function receiptPosting(input: {
  amount: number;
  customerId: string;
  projectId?: string;
  cashBankAccountId: string;
}) {
  return [
    { accountId: input.cashBankAccountId, debit: input.amount, customerId: input.customerId, projectId: input.projectId, description: "Customer receipt" },
    { accountId: INITIAL_ACCOUNT_IDS.accountsReceivable, credit: input.amount, customerId: input.customerId, projectId: input.projectId, description: "Settle accounts receivable" },
  ];
}

export function supplierPaymentPosting(input: {
  amount: number;
  supplierId: string;
  projectId?: string;
  cashBankAccountId: string;
}) {
  return [
    { accountId: INITIAL_ACCOUNT_IDS.accountsPayable, debit: input.amount, supplierId: input.supplierId, projectId: input.projectId, description: "Settle accounts payable" },
    { accountId: input.cashBankAccountId, credit: input.amount, supplierId: input.supplierId, projectId: input.projectId, description: "Supplier payment" },
  ];
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
  if (input.gst) lines.push({ accountId: "ACC-1140", debit: input.gst, supplierId: input.supplierId, projectId: input.projectId, taxCode: "GST", description: "Input GST" });
  lines.push({ accountId: input.cashBankAccountId, credit: input.total, supplierId: input.supplierId, projectId: input.projectId, description: "Expense payment" });
  return lines;
}
