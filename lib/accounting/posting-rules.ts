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
