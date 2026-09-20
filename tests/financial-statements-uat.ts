import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountTypeGL, NormalBalance, PrismaClient } from "@prisma/client";
import { buildFinancialStatements } from "../lib/accounting/financial-statements";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";
import { prisma } from "../src/lib/prisma";

async function main() {
  await verifyLiveDatabase();

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-financial-statements-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });

  try {
    const accounts = await client.chartOfAccounts.findMany({
      where: { isActive: true },
      include: { children: { select: { id: true } } },
      orderBy: { code: "asc" },
    });

    const existingAsset = accounts.find((row) => row.type === "ASSET" && row.children.length === 0);
    const existingRevenue = accounts.find((row) => row.type === "REVENUE" && row.children.length === 0);

    const asset = existingAsset || await client.chartOfAccounts.upsert({
      where: { code: "UAT-FS-ASSET" },
      update: { isActive: true },
      create: {
        code: "UAT-FS-ASSET",
        name: "UAT Financial Statements Asset",
        type: AccountTypeGL.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isActive: true,
      },
    });

    const revenue = existingRevenue || await client.chartOfAccounts.upsert({
      where: { code: "UAT-FS-REV" },
      update: { isActive: true },
      create: {
        code: "UAT-FS-REV",
        name: "UAT Financial Statements Revenue",
        type: AccountTypeGL.REVENUE,
        normalBalance: NormalBalance.CREDIT,
        isActive: true,
      },
    });

    const existingFixture = await client.journalHeader.findUnique({ where: { code: "UAT-FS-REVENUE" } });
    if (existingFixture) {
      await client.journalLine.deleteMany({ where: { journalId: existingFixture.id } });
      await client.journalHeader.delete({ where: { id: existingFixture.id } });
    }

    await client.journalHeader.create({
      data: {
        code: "UAT-FS-REVENUE",
        date: new Date("2026-09-10T00:00:00+10:00"),
        description: "UAT revenue classification journal",
        reference: "UAT-FS-REVENUE",
        sourceDocType: "JOURNAL_ENTRY",
        status: "POSTED",
        currency: "PGK",
        totalDebit: 100,
        totalCredit: 100,
        isBalanced: true,
        createdBy: "financial-statements-uat",
        approvedBy: "financial-statements-uat",
        approvedAt: new Date(),
        postedAt: new Date(),
        lines: {
          create: [
            {
              lineNo: 1,
              accountId: asset.id,
              description: "UAT asset debit",
              debit: 100,
              credit: 0,
              amount: 100,
              currency: "PGK",
            },
            {
              lineNo: 2,
              accountId: revenue.id,
              description: "UAT revenue credit",
              debit: 0,
              credit: 100,
              amount: 100,
              currency: "PGK",
            },
          ],
        },
      },
    });

    const statements = await buildFinancialStatements({ from: "2026-01-01", asOf: "2026-09-12" }, client);

    if (!statements.controls.periodLedger.balanced) throw new Error("Period ledger is not balanced");
    if (!statements.controls.cumulativeLedger.balanced) throw new Error("Cumulative ledger is not balanced");
    if (!statements.balanceSheet.totals.balanced) {
      throw new Error(`Accounting equation differs by ${statements.balanceSheet.totals.difference}`);
    }

    const arRows = statements.aging.receivables.rows.reduce((sum, row) => sum + row.outstanding, 0);
    const apRows = statements.aging.payables.rows.reduce((sum, row) => sum + row.outstanding, 0);
    if (Math.abs(arRows - statements.aging.receivables.total) >= 0.01) {
      throw new Error("AR aging rows do not total");
    }
    if (Math.abs(apRows - statements.aging.payables.total) >= 0.01) {
      throw new Error("AP aging rows do not total");
    }

    const classifiedRevenue = statements.profitAndLoss.revenue.find((row) => row.code === revenue.code);
    if (!classifiedRevenue || classifiedRevenue.amount < 99.99) {
      throw new Error("Posted revenue account was not classified into Profit & Loss");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      period: statements.period,
      periodLedger: statements.controls.periodLedger,
      balanceSheet: statements.balanceSheet.totals,
      profitAndLoss: statements.profitAndLoss.totals,
      classifiedRevenue: { code: classifiedRevenue.code, amount: classifiedRevenue.amount },
      receivablesControl: statements.controls.receivables,
      payablesControl: statements.controls.payables,
      arDocuments: statements.aging.receivables.rows.length,
      apDocuments: statements.aging.payables.rows.length,
    }, null, 2));
  } finally {
    await client.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
      throw new Error("Unsafe UAT cleanup path");
    }
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
