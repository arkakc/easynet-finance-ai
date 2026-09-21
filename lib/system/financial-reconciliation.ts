import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { buildFinancialStatements } from "@/lib/accounting/financial-statements";
import { inventoryState } from "@/lib/accounting/inventory";
import { prisma } from "@/src/lib/prisma";

const snapshotDirectory = path.join(process.cwd(), "backups", "reconciliation");
type AccountBalance = {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  debit: number;
  credit: number;
  balance: number;
};

export type FinancialReconciliationSnapshot = {
  formatVersion: 1;
  fileName: string;
  generatedAt: string;
  generatedBy: string;
  asOf: string;
  currency: string;
  source: "local-sqlite" | "postgresql-target";
  ledger: {
    postedJournals: number;
    journalLines: number;
    totalDebit: number;
    totalCredit: number;
    difference: number;
    accounts: AccountBalance[];
  };
  receivables: { documents: number; outstanding: number; unpostedDocuments: number; outputGst: number; glBalance: number; difference: number; matched: boolean };
  payables: { documents: number; outstanding: number; unpostedDocuments: number; inputGst: number; glBalance: number; difference: number; matched: boolean };
  inventory: { stockLines: number; quantityOnHand: number; availableQuantity: number; estimatedValue: number; negativeStockLines: number };
  banking: { activeAccounts: number; mappedAccounts: number; glBookBalance: number; unreconciledTransactions: number };
  masters: { customers: number; suppliers: number; items: number; activeUsers: number };
  controls: { ledgerBalanced: boolean; migrationReady: boolean; exceptions: string[] };
  fingerprint: string;
};

export type SnapshotComparison = {
  baselineFile: string;
  comparedAt: string;
  asOf: string;
  passed: boolean;
  tolerance: number;
  differences: Array<{ metric: string; baseline: number; current: number; difference: number; passed: boolean }>;
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function endOfPngDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("asOf must use YYYY-MM-DD");
  const date = new Date(`${value}T23:59:59.999+10:00`);
  const normalized = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  if (normalized !== value) throw new Error("Invalid asOf date");
  return date;
}

function fingerprint<T extends object>(value: T) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolveSnapshotPath(fileName: string) {
  if (!/^reconciliation-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}\.json$/i.test(fileName)) {
    throw new Error("Invalid reconciliation snapshot file name");
  }
  const resolved = path.resolve(snapshotDirectory, fileName);
  const relative = path.relative(snapshotDirectory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe reconciliation snapshot path");
  return resolved;
}

export async function buildFinancialReconciliationSnapshot(options?: {
  client?: PrismaClient;
  asOf?: string;
  generatedBy?: string;
  fileName?: string;
  source?: "local-sqlite" | "postgresql-target";
}): Promise<FinancialReconciliationSnapshot> {
  const client = options?.client || prisma;
  const asOf = options?.asOf || new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const periodEnd = endOfPngDay(asOf);
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const fileName = options?.fileName || `reconciliation-${stamp}-${randomUUID().slice(0, 8)}.json`;

  const [journals, invoices, bills, stock, bankAccounts, customers, suppliers, items, activeUsers, statements] = await Promise.all([
    client.journalHeader.findMany({
      where: { status: "POSTED", date: { lte: periodEnd } },
      include: { lines: { include: { account: true } } },
      orderBy: { code: "asc" },
    }),
    client.invoice.findMany({
      where: {
        issuedDate: { lte: periodEnd },
        code: { not: { startsWith: "CN-" } },
        status: { notIn: ["CANCELLED", "VOID"] },
      },
      select: { outstanding: true, taxTotal: true, glPosted: true },
    }),
    client.supplierBill.findMany({
      where: {
        billDate: { lte: periodEnd },
        status: { notIn: ["CANCELLED", "VOID"] },
      },
      select: { outstanding: true, taxTotal: true, glPosted: true },
    }),
    client.stockMovement.findMany({
      where: { createdAt: { lte: periodEnd } },
      select: {
        itemId: true,
        warehouseId: true,
        type: true,
        quantity: true,
        totalCost: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.bankAccount.findMany({
      where: { isActive: true },
      include: {
        chartOfAccounts: true,
        transactions: { where: { date: { lte: periodEnd }, isReconciled: false }, select: { id: true } },
      },
    }),
    client.customer.count(),
    client.supplier.count(),
    client.item.count(),
    client.user.count({ where: { status: "ACTIVE" } }),
    buildFinancialStatements({ from: "1900-01-01", asOf }, client),
  ]);
  const baseCurrency = statements.currency;

  const balanceMap = new Map<string, AccountBalance>();
  let totalDebit = 0;
  let totalCredit = 0;
  let journalLineCount = 0;
  let unbalancedJournals = 0;
  for (const journal of journals) {
    if (money(numberValue(journal.totalDebit) - numberValue(journal.totalCredit)) !== 0) unbalancedJournals += 1;
    for (const line of journal.lines) {
      journalLineCount += 1;
      const debit = numberValue(line.debit);
      const credit = numberValue(line.credit);
      totalDebit += debit;
      totalCredit += credit;
      const current = balanceMap.get(line.accountId) || {
        code: line.account.code,
        name: line.account.name,
        type: String(line.account.type),
        normalBalance: String(line.account.normalBalance),
        debit: 0,
        credit: 0,
        balance: 0,
      };
      current.debit += debit;
      current.credit += credit;
      balanceMap.set(line.accountId, current);
    }
  }

  const accounts = [...balanceMap.values()].map((account) => {
    const debit = money(account.debit);
    const credit = money(account.credit);
    const creditNormal = account.normalBalance === "CREDIT";
    return { ...account, debit, credit, balance: money(creditNormal ? credit - debit : debit - credit) };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const accountBalanceByCode = new Map(accounts.map((account) => [account.code, account.balance]));

  const receivables = {
    documents: statements.aging.receivables.rows.length,
    outstanding: money(statements.aging.receivables.total),
    unpostedDocuments: invoices.filter((invoice) => !invoice.glPosted).length,
    outputGst: money(invoices.reduce((sum, invoice) => sum + numberValue(invoice.taxTotal), 0)),
    glBalance: money(statements.controls.receivables.glBalance),
    difference: money(statements.controls.receivables.difference),
    matched: statements.controls.receivables.matched,
  };
  const payables = {
    documents: statements.aging.payables.rows.length,
    outstanding: money(statements.aging.payables.total),
    unpostedDocuments: bills.filter((bill) => !bill.glPosted).length,
    inputGst: money(bills.reduce((sum, bill) => sum + numberValue(bill.taxTotal), 0)),
    glBalance: money(statements.controls.payables.glBalance),
    difference: money(statements.controls.payables.difference),
    matched: statements.controls.payables.matched,
  };
  const incomingMovementTypes = new Set([
    "PURCHASE_IN",
    "PURCHASE_RECEIPT",
    "SALES_ISSUE_ROLLBACK",
    "ADJUSTMENT_IN",
    "RETURN_IN",
    "TRANSFER_IN",
  ]);
  const outgoingMovementTypes = new Set([
    "SALES_DELIVERY",
    "SALES_ISSUE",
    "SALE_OUT",
    "PROJECT_ISSUE",
    "ADJUSTMENT_OUT",
    "RETURN_OUT",
    "TRANSFER_OUT",
  ]);
  const valueAdjustmentTypes = new Set(["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"]);
  const stockByLocation = new Map<string, Array<{ qtyIn: number; qtyOut: number; value: number; valueAdjustment: number }>>();
  for (const row of stock) {
    const type = String(row.type || "").toUpperCase();
    const quantity = numberValue(row.quantity);
    const totalCost = numberValue(row.totalCost);
    const key = `${row.itemId}::${row.warehouseId || "LEGACY"}`;
    const rows = stockByLocation.get(key) || [];
    rows.push({
      qtyIn: incomingMovementTypes.has(type) ? quantity : 0,
      qtyOut: outgoingMovementTypes.has(type) ? quantity : 0,
      value: valueAdjustmentTypes.has(type) ? 0 : Math.abs(totalCost),
      valueAdjustment: valueAdjustmentTypes.has(type) ? totalCost : 0,
    });
    stockByLocation.set(key, rows);
  }
  const stockStates = [...stockByLocation.values()].map((rows) => inventoryState(rows));
  const inventory = {
    stockLines: stockStates.length,
    quantityOnHand: money(stockStates.reduce((sum, row) => sum + row.qty, 0)),
    // Reservation history is not event-sourced, so the historical snapshot uses
    // physical quantity as the auditable available quantity at the cut-off.
    availableQuantity: money(stockStates.reduce((sum, row) => sum + row.qty, 0)),
    estimatedValue: money(stockStates.reduce((sum, row) => sum + row.value, 0)),
    negativeStockLines: stockStates.filter((row) => row.qty < 0).length,
  };
  const banking = {
    activeAccounts: bankAccounts.length,
    mappedAccounts: bankAccounts.filter((account) => Boolean(account.chartOfAccounts)).length,
    glBookBalance: money(bankAccounts.reduce((sum, account) => sum + (account.chartOfAccounts ? accountBalanceByCode.get(account.chartOfAccounts.code) || 0 : 0), 0)),
    unreconciledTransactions: bankAccounts.reduce((sum, account) => sum + account.transactions.length, 0),
  };

  const ledgerDifference = money(totalDebit - totalCredit);
  const exceptions: string[] = [];
  if (ledgerDifference !== 0) exceptions.push(`Posted ledger is out of balance by ${baseCurrency} ${Math.abs(ledgerDifference).toFixed(2)}`);
  if (unbalancedJournals) exceptions.push(`${unbalancedJournals} posted journal(s) are individually unbalanced`);
  if (receivables.unpostedDocuments) exceptions.push(`${receivables.unpostedDocuments} active sales invoice(s) are not GL-posted`);
  if (payables.unpostedDocuments) exceptions.push(`${payables.unpostedDocuments} active supplier bill(s) are not GL-posted`);
  if (!receivables.matched) exceptions.push(`Accounts receivable control differs from the customer subledger by ${baseCurrency} ${Math.abs(receivables.difference).toFixed(2)}`);
  if (!payables.matched) exceptions.push(`Accounts payable control differs from the supplier subledger by ${baseCurrency} ${Math.abs(payables.difference).toFixed(2)}`);
  if (inventory.negativeStockLines) exceptions.push(`${inventory.negativeStockLines} stock line(s) have negative quantity`);
  if (banking.mappedAccounts !== banking.activeAccounts) exceptions.push(`${banking.activeAccounts - banking.mappedAccounts} active bank account(s) lack a GL mapping`);
  if (banking.unreconciledTransactions) exceptions.push(`${banking.unreconciledTransactions} bank transaction(s) remain unreconciled`);

  const content = {
    formatVersion: 1 as const,
    fileName,
    generatedAt,
    generatedBy: options?.generatedBy || "local-system",
    asOf,
    currency: baseCurrency,
    source: options?.source || "local-sqlite" as const,
    ledger: {
      postedJournals: journals.length,
      journalLines: journalLineCount,
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
      difference: ledgerDifference,
      accounts,
    },
    receivables,
    payables,
    inventory,
    banking,
    masters: { customers, suppliers, items, activeUsers },
    controls: { ledgerBalanced: ledgerDifference === 0 && unbalancedJournals === 0, migrationReady: exceptions.length === 0, exceptions },
  };
  return { ...content, fingerprint: fingerprint(content) };
}

export async function saveFinancialReconciliationSnapshot(options?: {
  client?: PrismaClient;
  asOf?: string;
  generatedBy?: string;
  source?: "local-sqlite" | "postgresql-target";
}) {
  await fs.mkdir(snapshotDirectory, { recursive: true });
  const snapshot = await buildFinancialReconciliationSnapshot(options);
  const target = resolveSnapshotPath(snapshot.fileName);
  const temporary = `${target}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return snapshot;
}

export async function readFinancialReconciliationSnapshot(fileName: string) {
  const snapshot = JSON.parse(await fs.readFile(resolveSnapshotPath(fileName), "utf8")) as FinancialReconciliationSnapshot;
  const { fingerprint: expected, ...content } = snapshot;
  if (snapshot.fileName !== fileName || fingerprint(content) !== expected) throw new Error("Reconciliation snapshot fingerprint mismatch");
  return snapshot;
}

export async function listFinancialReconciliationSnapshots() {
  await fs.mkdir(snapshotDirectory, { recursive: true });
  const entries = await fs.readdir(snapshotDirectory, { withFileTypes: true });
  const snapshots = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^reconciliation-.*\.json$/i.test(entry.name))
    .map((entry) => readFinancialReconciliationSnapshot(entry.name)));
  return snapshots.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function compareFinancialReconciliationSnapshot(fileName: string): Promise<SnapshotComparison> {
  const baseline = await readFinancialReconciliationSnapshot(fileName);
  const current = await buildFinancialReconciliationSnapshot({ asOf: baseline.asOf, generatedBy: "comparison" });
  return compareFinancialSnapshots(baseline, current);
}

export function compareFinancialSnapshots(
  baseline: FinancialReconciliationSnapshot,
  current: FinancialReconciliationSnapshot,
): SnapshotComparison {
  const tolerance = 0.01;
  const metrics: Array<[string, number, number]> = [
    ["Ledger total debit", baseline.ledger.totalDebit, current.ledger.totalDebit],
    ["Ledger total credit", baseline.ledger.totalCredit, current.ledger.totalCredit],
    ["Accounts receivable", baseline.receivables.outstanding, current.receivables.outstanding],
    ["Accounts payable", baseline.payables.outstanding, current.payables.outstanding],
    ["Inventory quantity", baseline.inventory.quantityOnHand, current.inventory.quantityOnHand],
    ["Estimated inventory value", baseline.inventory.estimatedValue, current.inventory.estimatedValue],
    ["Bank GL book balance", baseline.banking.glBookBalance, current.banking.glBookBalance],
    ["Customer count", baseline.masters.customers, current.masters.customers],
    ["Supplier count", baseline.masters.suppliers, current.masters.suppliers],
    ["Item count", baseline.masters.items, current.masters.items],
  ];
  const baselineAccounts = new Map(baseline.ledger.accounts.map((account) => [account.code, account.balance]));
  const currentAccounts = new Map(current.ledger.accounts.map((account) => [account.code, account.balance]));
  for (const code of new Set([...baselineAccounts.keys(), ...currentAccounts.keys()])) {
    metrics.push([`GL account ${code}`, baselineAccounts.get(code) || 0, currentAccounts.get(code) || 0]);
  }
  const differences = metrics.map(([metric, baselineValue, currentValue]) => {
    const difference = money(currentValue - baselineValue);
    return { metric, baseline: baselineValue, current: currentValue, difference, passed: Math.abs(difference) <= tolerance };
  });
  return {
    baselineFile: baseline.fileName,
    comparedAt: new Date().toISOString(),
    asOf: baseline.asOf,
    passed: differences.every((row) => row.passed),
    tolerance,
    differences,
  };
}
