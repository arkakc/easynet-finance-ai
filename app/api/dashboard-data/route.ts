import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { buildFinancialStatements } from "@/lib/accounting/financial-statements";
import { pngToday } from "@/lib/accounting/period-close";
import { prisma } from "@/src/lib/prisma";

type DashboardKPI = { key: string; value: string | number; updatedAt: string };

const numberValue = (value: unknown) => Number(value || 0);

async function localDashboardData() {
  const [statements, purchaseOrders, draftApprovals, activeProjects, sourcePending] = await Promise.all([
    buildFinancialStatements({ asOf: pngToday() }),
    prisma.purchaseOrder.findMany({ where: { status: { notIn: ["BILLED", "CLOSED", "Cancelled"] } } }),
    prisma.approvalRequest.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] } } }),
    prisma.project.count({ where: { status: "ACTIVE" } }),
    prisma.document.count({ where: { fileUrl: null, status: { not: "ARCHIVED" } } }),
  ]);

  const cashBank = statements.balanceSheet.assets.filter((row) => /^(111|112)/.test(row.code)).reduce((sum, row) => sum + row.amount, 0);
  const accountsReceivable = statements.controls.receivables.glBalance;
  const accountsPayable = statements.controls.payables.glBalance;
  const gstLiability = statements.balanceSheet.liabilities.filter((row) => /GST/i.test(row.name)).reduce((sum, row) => sum + row.amount, 0);
  const gstAsset = statements.balanceSheet.assets.filter((row) => /GST/i.test(row.name)).reduce((sum, row) => sum + row.amount, 0);
  const gstPayable = gstLiability - gstAsset;
  const revenue = statements.profitAndLoss.totals.revenue;
  const expensesTotal = statements.profitAndLoss.totals.expenses;
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
      { key: "draftApprovals", value: draftApprovals, updatedAt },
      { key: "activeProjects", value: activeProjects, updatedAt },
      { key: "sourcePending", value: sourcePending, updatedAt },
      { key: "arSubledger", value: statements.controls.receivables.subledgerBalance, updatedAt },
      { key: "apSubledger", value: statements.controls.payables.subledgerBalance, updatedAt },
      { key: "arReconciliationDifference", value: statements.controls.receivables.difference, updatedAt },
      { key: "apReconciliationDifference", value: statements.controls.payables.difference, updatedAt },
      { key: "gstStatus", value: "LOCAL", updatedAt },
    ] satisfies DashboardKPI[],
    services: {
      core: { ok: true, version: "sqlite-prisma" },
      reporting: { ok: true, version: "sqlite-prisma" },
      document: { ok: true, version: "sqlite-prisma" },
    },
  };
}

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    return NextResponse.json({
      ok: true,
      mode: "prisma",
      coreAuthority: "prisma",
      ...(await localDashboardData()),
      backendError: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard data load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}
