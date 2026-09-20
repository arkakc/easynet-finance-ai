import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";

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

export const roundPostingAmount = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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

  debit = roundPostingAmount(debit);
  credit = roundPostingAmount(credit);
  if (debit !== credit) {
    throw new Error(`Journal is not balanced: debit ${debit.toFixed(2)} vs credit ${credit.toFixed(2)}`);
  }
  return { debit, credit };
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
    const amount = roundPostingAmount(Number(line.amount || 0));
    if (!(amount > 0)) continue;
    if (line.deferred) {
      deferredRevenue = roundPostingAmount(deferredRevenue + amount);
    } else {
      immediateRevenue.set(
        line.accountId,
        roundPostingAmount((immediateRevenue.get(line.accountId) || 0) + amount),
      );
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
    const amount = roundPostingAmount(Number(line.amount || 0));
    if (amount > 0) {
      cogsGrouped.set(
        line.accountId,
        roundPostingAmount((cogsGrouped.get(line.accountId) || 0) + amount),
      );
    }
  }

  let totalCogs = 0;
  for (const [accountId, amount] of cogsGrouped.entries()) {
    totalCogs = roundPostingAmount(totalCogs + amount);
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
    const amount = roundPostingAmount(Number(line.amount || 0));
    if (amount > 0) {
      grouped.set(
        line.accountId,
        roundPostingAmount((grouped.get(line.accountId) || 0) + amount),
      );
    }
  }

  for (const [accountId, amount] of grouped.entries()) {
    lines.push({
      accountId,
      debit: amount,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Supplier cost",
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
    const amount = roundPostingAmount(Number(line.amount || 0));
    if (amount > 0) {
      serviceGrouped.set(
        line.accountId,
        roundPostingAmount((serviceGrouped.get(line.accountId) || 0) + amount),
      );
    }
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

  const receiptValue = roundPostingAmount(
    input.stockLines.reduce((sum, line) => sum + Number(line.receiptValue || 0), 0),
  );
  const stockInvoiceValue = roundPostingAmount(
    input.stockLines.reduce((sum, line) => sum + Number(line.invoiceAmount || 0), 0),
  );

  if (receiptValue > 0) {
    lines.push({
      accountId: input.stockReceivedButNotBilledAccountId || INITIAL_ACCOUNT_IDS.grni,
      debit: receiptValue,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Clear stock received but not billed",
    });
  }

  const purchasePriceVariance = roundPostingAmount(stockInvoiceValue - receiptValue);
  const ppvAccount = input.purchasePriceVarianceAccountId || INITIAL_ACCOUNT_IDS.purchasePriceVariance;

  if (purchasePriceVariance > 0) {
    lines.push({
      accountId: ppvAccount,
      debit: purchasePriceVariance,
      supplierId: input.supplierId,
      projectId: input.projectId,
      description: "Purchase price variance",
    });
  } else if (purchasePriceVariance < 0) {
    lines.push({
      accountId: ppvAccount,
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
  return {
    lines,
    purchasePriceVariance,
    receiptValue,
    stockInvoiceValue,
  };
}
