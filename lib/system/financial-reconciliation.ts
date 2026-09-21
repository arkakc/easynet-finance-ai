import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { companyBaseCurrency } from "@/lib/accounting/currency";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { inventoryState } from "@/lib/accounting/inventory";
import { prisma } from "@/src/lib/prisma";

const snapshotDirectory = path.join(process.cwd(), "backups", "reconciliation");
const OPEN_INVOICE_STATUSES = ["SENT", "PARTIAL", "PAID", "OVERDUE"] as const;
const OPEN_BILL_STATUSES = ["SENT", "PARTIAL", "PAID", "OVERDUE"] as const;

const INCOMING_STOCK = new Set([
  "PURCHASE_IN", "PURCHASE_RECEIPT", "SALES_ISSUE_ROLLBACK", "ADJUSTMENT_IN", "RETURN_IN", "TRANSFER_IN",
]);
const OUTGOING_STOCK = new Set([
  "SALES_DELIVERY", "SALES_ISSUE", "SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_OUT", "RETURN_OUT", "TRANSFER_OUT",
]);
const STOCK_VALUE_ADJUSTMENTS = new Set(["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"]);

type AccountBalance = {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  debit: number;
  credit: number;
  balance: number;
};

type BankReconciliationControl = {
  bankAccountId: string;
  bankCode: string;
  currency: string;
  mappedAccountCode: string;
  currentBaseGlBalance: number;
  latestReconciliationId: string | null;
  latestPeriodEnd: string | null;
  storedBookBalance: number | null;
  recomputedBookBalance: number | null;
  storedDifference: number | null;
  drift: number;
  matched: boolean;
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
  receivables: {
    documents: number;
    outstanding: number;
    unpostedDocuments: number;
    outputGst: number;
    glBalance: number;
    difference: number;
    matched: boolean;
    controlAccount: string;
  };
  payables: {
    documents: number;
    outstanding: number;
    unpostedDocuments: number;
    inputGst: number;
    glBalance: number;
    difference: number;
    matched: boolean;
    controlAccount: string;
  };
  inventory: {
    stockLines: number;
    quantityOnHand: number;
    availableQuantity: number;
    estimatedValue: number;
    negativeStockLines: number;
    glBalance: number;
    difference: number;
    matched: boolean;
    controlAccount: string;
  };
  banking: {
    activeAccounts: number;
    mappedAccounts: number;
    glBookBalance: number;
    unreconciledTransactions: number;
    reconciliationAccounts: number;
    reconciliationDrift: number;
    reconciliationsMatched: boolean;
    accounts: BankReconciliationControl[];
  };
  masters: { customers: number; suppliers: number; items: number; activeUsers: number };
  controls: {
    ledgerBalanced: boolean;
    receivablesMatched: boolean;
    payablesMatched: boolean;
    inventoryMatched: boolean;
    bankReconciliationsMatched: boolean;
    migrationReady: boolean;
    exceptions: string[];
  };
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
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function endOfPngDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("asOf must use YYYY-MM-DD");
  const date = new Date(`${value}T23:59:59.999+10:00`);
  const normalized = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function accountCode(value: unknown, fallback: string) {
  const clean = String(value || fallback).split("—")[0].trim().replace(/^ACC-/i, "");
  return clean || String(fallback).replace(/^ACC-/i, "");
}

function stockStateRow(row: { type: unknown; quantity: unknown; totalCost: unknown }) {
  const type = String(row.type || "").toUpperCase();
  const quantity = numberValue(row.quantity);
  const totalCost = numberValue(row.totalCost);
  const adjustment = STOCK_VALUE_ADJUSTMENTS.has(type);
  return {
    qtyIn: INCOMING_STOCK.has(type) ? quantity : 0,
    qtyOut: OUTGOING_STOCK.has(type) ? quantity : 0,
    value: adjustment ? 0 : Math.abs(totalCost),
    valueAdjustment: adjustment ? totalCost : 0,
  };
}

export async function buildFinancialReconciliationSnapshot(options?: {
  client?: PrismaClient;
  asOf?: string;
  generatedBy?: string;
  fileName?: string;
  source?: "local-sqlite" | "postgresql-target";
}): Promise<FinancialReconciliationSnapshot> {
  const client = options?.client || prisma;
  const asOf = options?.asOf || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const periodEnd = endOfPngDay(asOf);
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const fileName = options?.fileName || `reconciliation-${stamp}-${randomUUID().slice(0, 8)}.json`;

  const [
    journals,
    accountsMaster,
    invoices,
    bills,
    stockMovements,
    bankAccounts,
    customers,
    suppliers,
    items,
    activeUsers,
    settingsRows,
    activeFxRevaluations,
    baseCurrency,
  ] = await Promise.all([
    client.journalHeader.findMany({
      where: { status: "POSTED", date: { lte: periodEnd } },
      include: { lines: true },
      orderBy: [{ date: "asc" }, { code: "asc" }],
    }),
    client.chartOfAccounts.findMany({
      select: { id: true, code: true, name: true, type: true, normalBalance: true, parentId: true },
      orderBy: { code: "asc" },
    }),
    client.invoice.findMany({
      where: { issuedDate: { lte: periodEnd }, status: { in: [...OPEN_INVOICE_STATUSES] } },
      include: {
        paymentAllocations: {
          where: {
            allocationDate: { lte: periodEnd },
            OR: [{ reversalDate: null }, { reversalDate: { gt: periodEnd } }],
          },
          select: { amount: true, baseAmount: true },
        },
        originalCreditNotes: {
          where: { issueDate: { lte: periodEnd }, glPosted: true, status: { not: "CANCELLED" } },
          select: { total: true },
        },
      },
    }),
    client.supplierBill.findMany({
      where: { billDate: { lte: periodEnd }, status: { in: [...OPEN_BILL_STATUSES] } },
      include: {
        paymentAllocations: {
          where: {
            allocationDate: { lte: periodEnd },
            OR: [{ reversalDate: null }, { reversalDate: { gt: periodEnd } }],
          },
          select: { amount: true, baseAmount: true },
        },
        refunds: {
          where: { refundDate: { lte: periodEnd }, glPosted: true, status: { not: "CANCELLED" } },
          select: { total: true },
        },
      },
    }),
    client.stockMovement.findMany({
      where: { createdAt: { lte: periodEnd } },
      select: {
        itemId: true,
        warehouseId: true,
        type: true,
        quantity: true,
        totalCost: true,
        item: { select: { purchasePrice: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.bankAccount.findMany({
      where: { isActive: true },
      include: {
        chartOfAccounts: { select: { id: true, code: true } },
        transactions: {
          where: { date: { lte: periodEnd }, isReconciled: false },
          select: { id: true },
        },
        reconciliations: {
          where: { status: "COMPLETED", periodEnd: { lte: periodEnd } },
          orderBy: { periodEnd: "desc" },
          take: 1,
        },
      },
      orderBy: { code: "asc" },
    }),
    client.customer.count(),
    client.supplier.count(),
    client.item.count(),
    client.user.count({ where: { status: "ACTIVE" } }),
    client.globalSettings.findMany({
      where: {
        key: {
          in: [
            "default_receivable_account",
            "default_payable_account",
            "default_inventory_account",
          ],
        },
      },
      select: { key: true, value: true },
    }),
    client.fxRevaluationLine.findMany({
      where: {
        revaluation: {
          revaluationDate: { lte: periodEnd },
          reversalDate: { gt: periodEnd },
          status: "POSTED",
        },
      },
      select: { documentId: true, baseDifference: true },
    }),
    client.$transaction((tx) => companyBaseCurrency(tx)),
  ]);

  const accountById = new Map(accountsMaster.map((account) => [account.id, account]));
  const children = new Map<string, string[]>();
  for (const account of accountsMaster) {
    if (account.parentId) children.set(account.parentId, [...(children.get(account.parentId) || []), account.id]);
  }

  const rawBalanceById = new Map<string, number>();
  const totalsById = new Map<string, { debit: number; credit: number }>();
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
      rawBalanceById.set(line.accountId, numberValue(rawBalanceById.get(line.accountId)) + debit - credit);
      const current = totalsById.get(line.accountId) || { debit: 0, credit: 0 };
      current.debit += debit;
      current.credit += credit;
      totalsById.set(line.accountId, current);
    }
  }

  const accounts: AccountBalance[] = accountsMaster
    .map((account) => {
      const totals = totalsById.get(account.id) || { debit: 0, credit: 0 };
      const debit = money(totals.debit);
      const credit = money(totals.credit);
      const raw = money(debit - credit);
      return {
        code: account.code,
        name: account.name,
        type: String(account.type),
        normalBalance: String(account.normalBalance),
        debit,
        credit,
        balance: money(account.normalBalance === "CREDIT" ? -raw : raw),
      };
    })
    .filter((account) => Math.abs(account.debit) >= 0.005 || Math.abs(account.credit) >= 0.005);

  const setting = new Map(settingsRows.map((row) => [row.key, String(row.value || "")]));
  const arCode = accountCode(setting.get("default_receivable_account"), INITIAL_ACCOUNT_IDS.accountsReceivable);
  const apCode = accountCode(setting.get("default_payable_account"), INITIAL_ACCOUNT_IDS.accountsPayable);
  const inventoryCode = accountCode(setting.get("default_inventory_account"), INITIAL_ACCOUNT_IDS.inventory);

  function rollup(code: string) {
    const root = accountsMaster.find((account) => account.code === code);
    if (!root) return 0;
    const ids = [root.id];
    for (let index = 0; index < ids.length; index += 1) {
      ids.push(...(children.get(ids[index]) || []));
    }
    const raw = [...new Set(ids)].reduce((sum, id) => sum + numberValue(rawBalanceById.get(id)), 0);
    return money(root.normalBalance === "CREDIT" ? -raw : raw);
  }

  const activeRevaluationByDocument = new Map<string, number>();
  for (const row of activeFxRevaluations) {
    activeRevaluationByDocument.set(
      row.documentId,
      money(numberValue(activeRevaluationByDocument.get(row.documentId)) + numberValue(row.baseDifference)),
    );
  }

  const invoiceControl = invoices.map((invoice) => {
    const rate = numberValue(invoice.exchangeRate) || 1;
    const transactionPaid = invoice.paymentAllocations.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const transactionCredits = invoice.originalCreditNotes.reduce((sum, row) => sum + numberValue(row.total), 0);
    const basePaid = invoice.paymentAllocations.reduce((sum, row) => {
      const stored = numberValue(row.baseAmount);
      return sum + (Math.abs(stored) >= 0.005 ? stored : numberValue(row.amount) * rate);
    }, 0);
    const baseCredits = transactionCredits * rate;
    const baseTotal = Math.abs(numberValue(invoice.baseTotal)) >= 0.005
      ? numberValue(invoice.baseTotal)
      : numberValue(invoice.total) * rate;
    const outstanding = money(Math.max(0, baseTotal - basePaid - baseCredits) + numberValue(activeRevaluationByDocument.get(invoice.id)));
    const baseTax = Math.abs(numberValue(invoice.baseTaxTotal)) >= 0.005
      ? numberValue(invoice.baseTaxTotal)
      : numberValue(invoice.taxTotal) * rate;
    return { outstanding, baseTax };
  });

  const billControl = bills.map((bill) => {
    const rate = numberValue(bill.exchangeRate) || 1;
    const transactionPaid = bill.paymentAllocations.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const transactionCredits = bill.refunds.reduce((sum, row) => sum + numberValue(row.total), 0);
    const basePaid = bill.paymentAllocations.reduce((sum, row) => {
      const stored = numberValue(row.baseAmount);
      return sum + (Math.abs(stored) >= 0.005 ? stored : numberValue(row.amount) * rate);
    }, 0);
    const baseCredits = transactionCredits * rate;
    const baseTotal = Math.abs(numberValue(bill.baseTotal)) >= 0.005
      ? numberValue(bill.baseTotal)
      : numberValue(bill.total) * rate;
    const outstanding = money(Math.max(0, baseTotal - basePaid - baseCredits) + numberValue(activeRevaluationByDocument.get(bill.id)));
    const baseTax = Math.abs(numberValue(bill.baseTaxTotal)) >= 0.005
      ? numberValue(bill.baseTaxTotal)
      : numberValue(bill.taxTotal) * rate;
    return { outstanding, baseTax };
  });

  const receivables = {
    documents: invoices.length,
    outstanding: money(invoiceControl.reduce((sum, row) => sum + row.outstanding, 0)),
    unpostedDocuments: invoices.filter((invoice) => !invoice.glPosted).length,
    outputGst: money(invoiceControl.reduce((sum, row) => sum + row.baseTax, 0)),
    glBalance: rollup(arCode),
    difference: 0,
    matched: false,
    controlAccount: arCode,
  };
  const payables = {
    documents: bills.length,
    outstanding: money(billControl.reduce((sum, row) => sum + row.outstanding, 0)),
    unpostedDocuments: bills.filter((bill) => !bill.glPosted).length,
    inputGst: money(billControl.reduce((sum, row) => sum + row.baseTax, 0)),
    glBalance: rollup(apCode),
    difference: 0,
    matched: false,
    controlAccount: apCode,
  };
  receivables.difference = money(receivables.glBalance - receivables.outstanding);
  receivables.matched = Math.abs(receivables.difference) < 0.01;
  payables.difference = money(payables.glBalance - payables.outstanding);
  payables.matched = Math.abs(payables.difference) < 0.01;

  const stockGroups = new Map<string, typeof stockMovements>();
  for (const movement of stockMovements) {
    const key = `${movement.itemId}:${movement.warehouseId || "UNASSIGNED"}`;
    stockGroups.set(key, [...(stockGroups.get(key) || []), movement]);
  }
  let quantityOnHand = 0;
  let estimatedValue = 0;
  let negativeStockLines = 0;
  for (const rows of stockGroups.values()) {
    const state = inventoryState(rows.map(stockStateRow), numberValue(rows[0]?.item.purchasePrice));
    quantityOnHand += state.qty;
    estimatedValue += state.value;
    if (state.qty < -0.0001) negativeStockLines += 1;
  }
  const inventoryGl = rollup(inventoryCode);
  const inventory = {
    stockLines: stockGroups.size,
    quantityOnHand: money(quantityOnHand),
    availableQuantity: money(quantityOnHand),
    estimatedValue: money(estimatedValue),
    negativeStockLines,
    glBalance: inventoryGl,
    difference: money(inventoryGl - estimatedValue),
    matched: Math.abs(inventoryGl - estimatedValue) < 0.01,
    controlAccount: inventoryCode,
  };

  function bankBookBalance(accountId: string, currency: string, throughDate: Date) {
    const bankCurrency = String(currency || baseCurrency).trim().toUpperCase();
    let amount = 0;
    for (const journal of journals) {
      if (journal.date > throughDate) continue;
      for (const line of journal.lines) {
        if (line.accountId !== accountId) continue;
        if (bankCurrency === baseCurrency) {
          amount += numberValue(line.debit) - numberValue(line.credit);
        } else if (String(line.transactionCurrency || "").toUpperCase() === bankCurrency) {
          amount += numberValue(line.transactionDebit) - numberValue(line.transactionCredit);
        }
      }
    }
    return money(amount);
  }

  const bankControls: BankReconciliationControl[] = bankAccounts.map((bank) => {
    const mappedId = bank.chartOfAccountsId || "";
    const currentBaseGlBalance = mappedId ? money(numberValue(rawBalanceById.get(mappedId))) : 0;
    const latest = bank.reconciliations[0] || null;
    const recomputedBookBalance = latest && mappedId
      ? bankBookBalance(mappedId, bank.currency, latest.periodEnd)
      : null;
    const storedBookBalance = latest ? numberValue(latest.bookBalance) : null;
    const storedDifference = latest ? numberValue(latest.difference) : null;
    const drift = latest && recomputedBookBalance !== null
      ? money(recomputedBookBalance - numberValue(storedBookBalance))
      : 0;
    const hasStatementActivity = bank.transactions.length > 0;
    const matched = Boolean(bank.chartOfAccounts)
      && (!latest ? !hasStatementActivity : Math.abs(drift) < 0.01 && Math.abs(numberValue(storedDifference)) < 0.01);
    return {
      bankAccountId: bank.id,
      bankCode: bank.code,
      currency: String(bank.currency || baseCurrency).toUpperCase(),
      mappedAccountCode: bank.chartOfAccounts?.code || "",
      currentBaseGlBalance,
      latestReconciliationId: latest?.id || null,
      latestPeriodEnd: latest?.periodEnd.toISOString().slice(0, 10) || null,
      storedBookBalance,
      recomputedBookBalance,
      storedDifference,
      drift,
      matched,
    };
  });

  const banking = {
    activeAccounts: bankAccounts.length,
    mappedAccounts: bankAccounts.filter((account) => Boolean(account.chartOfAccounts)).length,
    glBookBalance: money(bankControls.reduce((sum, row) => sum + row.currentBaseGlBalance, 0)),
    unreconciledTransactions: bankAccounts.reduce((sum, account) => sum + account.transactions.length, 0),
    reconciliationAccounts: bankControls.filter((row) => Boolean(row.latestReconciliationId)).length,
    reconciliationDrift: money(bankControls.reduce((sum, row) => sum + Math.abs(row.drift), 0)),
    reconciliationsMatched: bankControls.every((row) => row.matched),
    accounts: bankControls,
  };

  const ledgerDifference = money(totalDebit - totalCredit);
  const exceptions: string[] = [];
  if (ledgerDifference !== 0) exceptions.push(`Posted ledger is out of balance by ${baseCurrency} ${Math.abs(ledgerDifference).toFixed(2)}`);
  if (unbalancedJournals) exceptions.push(`${unbalancedJournals} posted journal(s) are individually unbalanced`);
  if (receivables.unpostedDocuments) exceptions.push(`${receivables.unpostedDocuments} active sales invoice(s) are not GL-posted`);
  if (payables.unpostedDocuments) exceptions.push(`${payables.unpostedDocuments} active supplier bill(s) are not GL-posted`);
  if (!receivables.matched) exceptions.push(`Accounts receivable control ${arCode} differs from the customer subledger by ${baseCurrency} ${Math.abs(receivables.difference).toFixed(2)}`);
  if (!payables.matched) exceptions.push(`Accounts payable control ${apCode} differs from the supplier subledger by ${baseCurrency} ${Math.abs(payables.difference).toFixed(2)}`);
  if (!inventory.matched) exceptions.push(`Inventory control ${inventoryCode} differs from stock valuation by ${baseCurrency} ${Math.abs(inventory.difference).toFixed(2)}`);
  if (inventory.negativeStockLines) exceptions.push(`${inventory.negativeStockLines} warehouse/item stock position(s) have negative quantity`);
  if (banking.mappedAccounts !== banking.activeAccounts) exceptions.push(`${banking.activeAccounts - banking.mappedAccounts} active bank account(s) lack a GL mapping`);
  if (!banking.reconciliationsMatched) exceptions.push("One or more bank reconciliations are missing or no longer match the controlled ledger");
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
    controls: {
      ledgerBalanced: ledgerDifference === 0 && unbalancedJournals === 0,
      receivablesMatched: receivables.matched,
      payablesMatched: payables.matched,
      inventoryMatched: inventory.matched,
      bankReconciliationsMatched: banking.reconciliationsMatched,
      migrationReady: exceptions.length === 0,
      exceptions,
    },
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
    ["Inventory value", baseline.inventory.estimatedValue, current.inventory.estimatedValue],
    ["Inventory GL", baseline.inventory.glBalance || 0, current.inventory.glBalance || 0],
    ["Bank GL book balance", baseline.banking.glBookBalance, current.banking.glBookBalance],
    ["Bank reconciliation drift", baseline.banking.reconciliationDrift || 0, current.banking.reconciliationDrift || 0],
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
