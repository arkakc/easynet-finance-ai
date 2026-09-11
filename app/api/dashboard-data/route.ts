import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { backendConfigStatus, backendHealthAll, listReportingTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

type DashboardKPI = { key: string; value: string | number; updatedAt: string };

const numberValue = (value: unknown) => Number(value || 0);

async function localDashboardData() {
  const [accounts, invoices, bills, expenses, purchaseOrders] = await Promise.all([
    prisma.bankAccount.findMany({ include: { transactions: true } }),
    prisma.invoice.findMany({ where: { status: { notIn: ["CANCELLED", "VOID"] } } }),
    prisma.supplierBill.findMany({ where: { status: { not: "CANCELLED" } } }),
    prisma.expense.findMany({ where: { glPosted: true } }),
    prisma.purchaseOrder.findMany({ where: { status: { notIn: ["BILLED", "CLOSED", "Cancelled"] } } }),
  ]);

  const cashBank = accounts.reduce(
    (total, account) => total + numberValue(account.openingBalance) + account.transactions.reduce((sum, transaction) => sum + numberValue(transaction.amount), 0),
    0,
  );
  const accountsReceivable = invoices.reduce((total, invoice) => total + numberValue(invoice.outstanding), 0);
  const accountsPayable = bills.reduce((total, bill) => total + numberValue(bill.outstanding), 0);
  const gstPayable = invoices.reduce((total, invoice) => total + numberValue(invoice.taxTotal), 0)
    - bills.reduce((total, bill) => total + numberValue(bill.taxTotal), 0);
  const revenue = invoices.reduce((total, invoice) => total + numberValue(invoice.total), 0);
  const expensesTotal = expenses.reduce((total, expense) => total + numberValue(expense.total), 0);
  const poCommitments = purchaseOrders.reduce((total, order) => total + numberValue(order.total) - numberValue(order.amountReceived), 0);
  const updatedAt = new Date().toISOString();

  return {
    rows: [
      { key: "cashBank", value: cashBank, updatedAt },
      { key: "accountsReceivable", value: accountsReceivable, updatedAt },
      { key: "accountsPayable", value: accountsPayable, updatedAt },
      { key: "gstPayable", value: gstPayable, updatedAt },
      { key: "revenuePosted", value: revenue, updatedAt },
      { key: "expensesPosted", value: expensesTotal, updatedAt },
      { key: "netProfitPosted", value: revenue - expensesTotal, updatedAt },
      { key: "poCommitments", value: poCommitments, updatedAt },
      { key: "gstStatus", value: "LOCAL", updatedAt },
    ] satisfies DashboardKPI[],
    services: {
      core: { ok: true, version: "local" },
      reporting: { ok: true, version: "local" },
      document: { ok: true, version: "local" },
    },
  };
}

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    const configuration = backendConfigStatus();
    const backendConfigured = Object.values(configuration).some((service) => service.source !== "unconfigured");

    if (!backendConfigured) {
      return NextResponse.json({ ok: true, mode: "local", ...(await localDashboardData()), backendError: "" });
    }

    const [reportingResult, healthResult] = await Promise.allSettled([
      listReportingTable<DashboardKPI>("ReportDashboardKPI", 100, 0),
      backendHealthAll(),
    ]);

    const rows = reportingResult.status === "fulfilled" ? reportingResult.value.rows : [];
    const services = healthResult.status === "fulfilled" ? healthResult.value : {};
    let backendError = "";

    if (reportingResult.status === "rejected") {
      backendError = reportingResult.reason instanceof Error
        ? reportingResult.reason.message
        : "Reporting backend read failed";
    } else if (!rows.length) {
      backendError = "Reporting summary is empty. Refresh the Reporting database materializer.";
    }

    return NextResponse.json({ ok: true, rows, services, backendError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard data load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}
