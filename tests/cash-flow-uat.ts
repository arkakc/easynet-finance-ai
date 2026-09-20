import { buildCashFlowStatement } from "../lib/accounting/cash-flow";
import { prisma } from "../src/lib/prisma";
import { PrismaClient } from "@prisma/client";

const fixture = process.env.UAT_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.UAT_DATABASE_URL }) : prisma;

async function main() {
  const statement = await buildCashFlowStatement({ from: "2026-01-01", asOf: "2026-09-12" }, fixture);
  if (!statement.control.balanced) throw new Error(`Cash-flow control differs by ${statement.control.difference}`);
  if (Math.abs(statement.totals.openingCash + statement.totals.netChange - statement.totals.closingCash) >= 0.01) throw new Error("Opening cash plus movement does not equal closing cash");
  if (!statement.cashAccounts.some((account) => account.code === "1122")) throw new Error("Kina Bank GL account was omitted");
  if (!statement.rows.length) throw new Error("Posted cash movements were not found");

  console.log(JSON.stringify({
    database: process.env.UAT_DATABASE_URL ? "verified SQLite fixture" : "live read-only",
    liveDatabaseChanged: false,
    period: statement.period,
    includedCashAccounts: statement.cashAccounts.length,
    movementRows: statement.rows.length,
    totals: statement.totals,
    control: statement.control,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => fixture !== prisma ? fixture.$disconnect() : prisma.$disconnect());
