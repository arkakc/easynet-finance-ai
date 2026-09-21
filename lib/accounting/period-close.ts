import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { buildFinancialStatements } from "@/lib/accounting/financial-statements";
import { appendAuditEvent } from "@/lib/security/audit";

export type CloseCheck = {
  key: string;
  label: string;
  severity: "PASS" | "WARNING" | "BLOCKING";
  count: number;
  message: string;
};

export type PeriodCloseChecklist = {
  month: string;
  periodStart: string;
  periodEnd: string;
  ready: boolean;
  blockingCount: number;
  warningCount: number;
  checks: CloseCheck[];
  totals: { postedJournals: number; totalDebit: number; totalCredit: number; difference: number };
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function pngToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Month must use YYYY-MM");
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(`${month}-01T00:00:00.000+10:00`);
  const end = new Date(Date.UTC(year, monthNumber, 0, 13, 59, 59, 999));
  return { start, end, startText: `${month}-01`, endText: end.toISOString().slice(0, 10) };
}

function check(input: Omit<CloseCheck, "severity"> & { blocking?: boolean; warning?: boolean }): CloseCheck {
  return {
    key: input.key,
    label: input.label,
    count: input.count,
    message: input.message,
    severity: input.count === 0 ? "PASS" : input.blocking ? "BLOCKING" : input.warning ? "WARNING" : "PASS",
  };
}

export async function buildPeriodCloseChecklist(month: string, client: PrismaClient = prisma): Promise<PeriodCloseChecklist> {
  const bounds = monthBounds(month);
  const period = { gte: bounds.start, lte: bounds.end };
  const [journals, pendingJournals, unpostedInvoices, unpostedBills, unreconciledBankRows, activeBanks, reconciledBanks, negativeStock, gstReports, statements] = await Promise.all([
    client.journalHeader.findMany({ where: { date: period, status: "POSTED" }, select: { totalDebit: true, totalCredit: true, isBalanced: true } }),
    client.journalHeader.count({ where: { date: period, status: { in: ["DRAFT", "PENDING"] } } }),
    client.invoice.count({ where: { issuedDate: period, status: { notIn: ["CANCELLED", "VOID"] }, glPosted: false } }),
    client.supplierBill.count({ where: { billDate: period, status: { notIn: ["CANCELLED", "VOID"] }, glPosted: false } }),
    client.bankTransaction.count({ where: { date: period, isReconciled: false } }),
    client.bankAccount.findMany({ where: { isActive: true }, select: { id: true, chartOfAccountsId: true } }),
    client.reconciliation.findMany({ where: { status: "COMPLETED", periodStart: { lte: bounds.start }, periodEnd: { gte: bounds.end } }, select: { bankAccountId: true } }),
    client.stockLevel.count({ where: { quantity: { lt: 0 } } }),
    client.taxReport.count({ where: { periodStart: { lte: bounds.end }, periodEnd: { gte: bounds.start }, status: { in: ["CALCULATED", "SUBMITTED", "PAID"] } } }),
    buildFinancialStatements({ from: "1900-01-01", asOf: bounds.endText }, client),
  ]);

  const totalDebit = money(journals.reduce((sum, row) => sum + Number(row.totalDebit || 0), 0));
  const totalCredit = money(journals.reduce((sum, row) => sum + Number(row.totalCredit || 0), 0));
  const difference = money(totalDebit - totalCredit);
  const unbalancedJournals = journals.filter((row) => !row.isBalanced || money(Number(row.totalDebit) - Number(row.totalCredit)) !== 0).length;
  const mappedBanks = activeBanks.filter((row) => Boolean(row.chartOfAccountsId)).length;
  const reconciledBankIds = new Set(reconciledBanks.map((row) => row.bankAccountId));
  const banksWithoutClose = activeBanks.filter((row) => !reconciledBankIds.has(row.id)).length;
  const periodNotEnded = bounds.endText >= pngToday() ? 1 : 0;

  const checks: CloseCheck[] = [
    check({ key: "period-ended", label: "Period has ended", count: periodNotEnded, blocking: true, message: periodNotEnded ? "Current or future periods cannot be closed" : `Period ended ${bounds.endText}` }),
    check({ key: "ledger-balanced", label: "Posted ledger balanced", count: difference === 0 ? 0 : 1, blocking: true, message: difference === 0 ? `Debit and credit both K${totalDebit.toFixed(2)}` : `Ledger difference is K${difference.toFixed(2)}` }),
    check({ key: "journal-balanced", label: "Individual journals balanced", count: unbalancedJournals, blocking: true, message: unbalancedJournals ? `${unbalancedJournals} posted journal(s) are unbalanced` : "Every posted journal is balanced" }),
    check({ key: "pending-journals", label: "No pending journals", count: pendingJournals, blocking: true, message: pendingJournals ? `${pendingJournals} draft/pending journal(s) remain` : "No draft or pending journals" }),
    check({ key: "sales-posted", label: "Sales invoices GL-posted", count: unpostedInvoices, blocking: true, message: unpostedInvoices ? `${unpostedInvoices} active invoice(s) are not GL-posted` : "All active invoices are posted" }),
    check({ key: "purchases-posted", label: "Supplier bills GL-posted", count: unpostedBills, blocking: true, message: unpostedBills ? `${unpostedBills} active supplier bill(s) are not GL-posted` : "All active supplier bills are posted" }),
    check({ key: "ar-reconciled", label: "Accounts receivable reconciled", count: statements.controls.receivables.matched ? 0 : 1, blocking: true, message: statements.controls.receivables.matched ? "Customer subledger matches the AR control account" : `AR control differs from the customer subledger by K${statements.controls.receivables.difference.toFixed(2)}` }),
    check({ key: "ap-reconciled", label: "Accounts payable reconciled", count: statements.controls.payables.matched ? 0 : 1, blocking: true, message: statements.controls.payables.matched ? "Supplier subledger matches the AP control account" : `AP control differs from the supplier subledger by K${statements.controls.payables.difference.toFixed(2)}` }),
    check({ key: "bank-mapped", label: "Bank accounts mapped", count: activeBanks.length - mappedBanks, blocking: true, message: mappedBanks === activeBanks.length ? "All active bank accounts have a GL mapping" : `${activeBanks.length - mappedBanks} active bank account(s) need a GL mapping` }),
    check({ key: "bank-rows", label: "Statement rows reconciled", count: unreconciledBankRows, blocking: true, message: unreconciledBankRows ? `${unreconciledBankRows} statement row(s) remain unreconciled` : "No unreconciled statement rows in this period" }),
    check({ key: "bank-close", label: "Bank periods completed", count: banksWithoutClose, blocking: true, message: banksWithoutClose ? `${banksWithoutClose} active bank account(s) lack a completed reconciliation covering the period` : "Every active bank account has a completed reconciliation" }),
    check({ key: "negative-stock", label: "No negative stock", count: negativeStock, blocking: true, message: negativeStock ? `${negativeStock} stock line(s) have negative quantity` : "No negative stock quantities" }),
    check({ key: "gst-report", label: "GST working paper prepared", count: gstReports ? 0 : 1, warning: true, message: gstReports ? "A calculated/submitted GST report covers this period" : "No calculated GST report covers this period" }),
  ];
  const blockingCount = checks.filter((row) => row.severity === "BLOCKING").length;
  const warningCount = checks.filter((row) => row.severity === "WARNING").length;
  return {
    month,
    periodStart: bounds.startText,
    periodEnd: bounds.endText,
    ready: blockingCount === 0,
    blockingCount,
    warningCount,
    checks,
    totals: { postedJournals: journals.length, totalDebit, totalCredit, difference },
  };
}

export async function closeAccountingPeriod(month: string, actorEmail: string, client: PrismaClient = prisma) {
  const checklist = await buildPeriodCloseChecklist(month, client);
  if (!checklist.ready) throw new Error(`Period is not ready: ${checklist.blockingCount} blocking control(s) remain`);
  const bounds = monthBounds(month);
  const dbUser = await client.user.findUnique({ where: { email: actorEmail } });
  if (!dbUser) throw new Error("Authenticated user no longer exists");

  const period = await client.$transaction(async (tx) => {
    const existing = await tx.accountingPeriod.findUnique({ where: { code: month } });
    if (existing?.status === "CLOSED") throw new Error("This accounting period is already closed");
    const currentLock = await tx.globalSettings.findUnique({ where: { key: "posting_lock_date" } });
    const saved = await tx.accountingPeriod.upsert({
      where: { code: month },
      create: {
        code: month,
        name: new Date(`${month}-01T00:00:00+10:00`).toLocaleDateString("en-PG", { month: "long", year: "numeric", timeZone: "Pacific/Port_Moresby" }),
        startDate: bounds.start,
        endDate: bounds.end,
        status: "CLOSED",
        closeReport: JSON.stringify(checklist),
        previousLockDate: currentLock?.value || "",
        closedBy: actorEmail,
        closedAt: new Date(),
      },
      update: { status: "CLOSED", closeReport: JSON.stringify(checklist), previousLockDate: currentLock?.value || "", closedBy: actorEmail, closedAt: new Date(), reopenedBy: null, reopenedAt: null, reopenReason: null },
    });
    const nextLock = !currentLock?.value || currentLock.value < checklist.periodEnd ? checklist.periodEnd : currentLock.value;
    await tx.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: nextLock, description: "No journals may post on or before this closed-period date", updatedBy: actorEmail },
      update: { value: nextLock, description: "No journals may post on or before this closed-period date", updatedBy: actorEmail, updatedAt: new Date() },
    });
    await appendAuditEvent({
      action: "CLOSE",
      entityType: "AccountingPeriod",
      entityId: saved.id,
      entityCode: month,
      description: `Closed accounting period through ${checklist.periodEnd}`,
      changes: checklist,
      actorEmail,
      userId: dbUser.id,
      outcome: "SUCCESS",
    }, tx);
    return saved;
  });
  return { period, checklist };
}

export async function reopenAccountingPeriod(month: string, actorEmail: string, reason: string, client: PrismaClient = prisma) {
  const dbUser = await client.user.findUnique({ where: { email: actorEmail } });
  if (!dbUser) throw new Error("Authenticated user no longer exists");
  const period = await client.accountingPeriod.findUnique({ where: { code: month } });
  if (!period || period.status !== "CLOSED") throw new Error("Only a closed accounting period can be reopened");
  const laterClosed = await client.accountingPeriod.count({ where: { status: "CLOSED", endDate: { gt: period.endDate } } });
  if (laterClosed) throw new Error("Reopen later closed periods first");

  const reopened = await client.$transaction(async (tx) => {
    const saved = await tx.accountingPeriod.update({ where: { id: period.id }, data: { status: "OPEN", reopenedBy: actorEmail, reopenedAt: new Date(), reopenReason: reason } });
    const latestClosed = await tx.accountingPeriod.findFirst({ where: { status: "CLOSED", id: { not: period.id } }, orderBy: { endDate: "desc" } });
    const nextLockDate = [latestClosed?.endDate.toISOString().slice(0, 10) || "", period.previousLockDate || ""].sort().at(-1) || "";
    await tx.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: nextLockDate, description: "No journals may post on or before this closed-period date", updatedBy: actorEmail },
      update: { value: nextLockDate, updatedBy: actorEmail, updatedAt: new Date() },
    });
    await appendAuditEvent({
      action: "REOPEN",
      entityType: "AccountingPeriod",
      entityId: saved.id,
      entityCode: month,
      description: `Reopened accounting period: ${reason}`,
      changes: {
        previousLockDate: period.endDate.toISOString().slice(0, 10),
        nextLockDate,
      },
      actorEmail,
      userId: dbUser.id,
      outcome: "SUCCESS",
    }, tx);
    return saved;
  });
  return reopened;
}
