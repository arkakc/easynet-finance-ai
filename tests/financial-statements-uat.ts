import { buildFinancialStatements } from "../lib/accounting/financial-statements";
import { prisma } from "../src/lib/prisma";
import { PrismaClient } from "@prisma/client";

const fixture = process.env.UAT_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.UAT_DATABASE_URL }) : prisma;

async function main() {
  const statements = await buildFinancialStatements({ from: "2026-01-01", asOf: "2026-09-12" }, fixture);
  if (!statements.controls.periodLedger.balanced) throw new Error("Period ledger is not balanced");
  if (!statements.controls.cumulativeLedger.balanced) throw new Error("Cumulative ledger is not balanced");
  if (!statements.balanceSheet.totals.balanced) throw new Error(`Accounting equation differs by ${statements.balanceSheet.totals.difference}`);
  const arRows = statements.aging.receivables.rows.reduce((sum, row) => sum + row.outstanding, 0);
  const apRows = statements.aging.payables.rows.reduce((sum, row) => sum + row.outstanding, 0);
  if (Math.abs(arRows - statements.aging.receivables.total) >= 0.01) throw new Error("AR aging rows do not total");
  if (Math.abs(apRows - statements.aging.payables.total) >= 0.01) throw new Error("AP aging rows do not total");
  if (!statements.profitAndLoss.revenue.length) throw new Error("Posted revenue accounts were not classified");

  console.log(JSON.stringify({
    database: process.env.UAT_DATABASE_URL ? "verified SQLite fixture" : "live read-only",
    liveDatabaseChanged: false,
    period: statements.period,
    periodLedger: statements.controls.periodLedger,
    balanceSheet: statements.balanceSheet.totals,
    profitAndLoss: statements.profitAndLoss.totals,
    receivablesControl: statements.controls.receivables,
    payablesControl: statements.controls.payables,
    arDocuments: statements.aging.receivables.rows.length,
    apDocuments: statements.aging.payables.rows.length,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => fixture !== prisma ? fixture.$disconnect() : prisma.$disconnect());
