import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { reversePostedJournal } from "../lib/accounting/journal-reversal";
import { buildFinancialStatements } from "../lib/accounting/financial-statements";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";
import { prisma } from "../src/lib/prisma";

const money = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function accountBalance(client: PrismaClient, accountId: string, asOf: Date) {
  const result = await client.journalLine.aggregate({
    where: { accountId, journal: { status: "POSTED", date: { lte: asOf } } },
    _sum: { debit: true, credit: true },
  });
  return money(Number(result._sum.debit || 0) - Number(result._sum.credit || 0));
}

async function main() {
  await verifyLiveDatabase();

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-journal-reversal-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });

  try {
    await client.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2026-08-31" },
      update: { value: "2026-08-31" },
    });

    const accounts = await client.chartOfAccounts.findMany({
      where: { isActive: true },
      include: { children: { select: { id: true } } },
      orderBy: { code: "asc" },
    });
    const asset = accounts.find((row) => row.type === "ASSET" && row.children.length === 0);
    const expense = accounts.find((row) => row.type === "EXPENSE" && row.children.length === 0);
    if (!asset || !expense) throw new Error("UAT requires one active leaf ASSET and EXPENSE account");

    const asOfText = "2026-09-30";
    const asOfDate = new Date("2026-09-30T23:59:59+10:00");
    const beforeAsset = await accountBalance(client, asset.id, asOfDate);
    const beforeExpense = await accountBalance(client, expense.id, asOfDate);
    const beforeStatements = await buildFinancialStatements({ from: "2026-01-01", asOf: asOfText }, client);

    const original = await client.journalHeader.create({
      data: {
        code: "UAT-REVERSAL-ORIGINAL",
        date: new Date("2026-09-15T00:00:00+10:00"),
        description: "Journal reversal UAT original",
        reference: "UAT-REVERSAL",
        sourceDocType: "JOURNAL_ENTRY",
        sourceDocId: "UAT-REVERSAL-SOURCE",
        status: "POSTED",
        currency: "PGK",
        totalDebit: 123.45,
        totalCredit: 123.45,
        isBalanced: true,
        createdBy: "journal-reversal-uat",
        approvedBy: "journal-reversal-uat",
        approvedAt: new Date(),
        postedAt: new Date(),
        lines: {
          create: [
            {
              lineNo: 1,
              accountId: expense.id,
              description: "UAT expense",
              debit: 123.45,
              credit: 0,
              amount: 123.45,
              currency: "PGK",
            },
            {
              lineNo: 2,
              accountId: asset.id,
              description: "UAT asset",
              debit: 0,
              credit: 123.45,
              amount: 123.45,
              currency: "PGK",
            },
          ],
        },
      },
    });

    let earlierDateBlocked = false;
    try {
      await reversePostedJournal({
        journalId: original.code,
        reversalDate: "2026-09-14",
        reason: "UAT earlier-date guard",
      }, client);
    } catch (error) {
      earlierDateBlocked = /earlier than the original/i.test(error instanceof Error ? error.message : String(error));
    }
    if (!earlierDateBlocked) throw new Error("Reversal before the original posting date was not blocked");

    const result = await reversePostedJournal({
      journalId: original.code,
      reversalDate: "2026-09-16",
      reason: "UAT proves immutable original plus posted counter-entry",
      createdBy: "journal-reversal-uat",
      approvedBy: "journal-reversal-uat",
    }, client);

    const [savedOriginal, reversal] = await Promise.all([
      client.journalHeader.findUnique({ where: { id: original.id }, include: { lines: true } }),
      client.journalHeader.findUnique({ where: { id: result.reversalDatabaseId }, include: { lines: true } }),
    ]);

    if (!savedOriginal || !reversal) throw new Error("Original or reversal journal disappeared");
    if (savedOriginal.status !== "POSTED") {
      throw new Error(`Original status changed to ${savedOriginal.status}; it must remain POSTED`);
    }
    if (reversal.status !== "POSTED") throw new Error("Reversal journal is not POSTED");
    if (reversal.reversalOfJournalId !== original.id) throw new Error("Reversal is not linked to the original journal");
    if (reversal.lines.length !== savedOriginal.lines.length) {
      throw new Error("Reversal line count does not match original");
    }

    for (let index = 0; index < savedOriginal.lines.length; index += 1) {
      const source = savedOriginal.lines[index];
      const inverse = reversal.lines[index];
      if (
        money(Number(source.debit)) !== money(Number(inverse.credit))
        || money(Number(source.credit)) !== money(Number(inverse.debit))
      ) {
        throw new Error(`Reversal line ${index + 1} is not the exact debit/credit inverse`);
      }
    }

    const afterAsset = await accountBalance(client, asset.id, asOfDate);
    const afterExpense = await accountBalance(client, expense.id, asOfDate);
    if (afterAsset !== beforeAsset || afterExpense !== beforeExpense) {
      throw new Error(
        `Reversal did not neutralize GL balances: asset ${beforeAsset}/${afterAsset}, expense ${beforeExpense}/${afterExpense}`,
      );
    }

    const afterStatements = await buildFinancialStatements({ from: "2026-01-01", asOf: asOfText }, client);
    if (afterStatements.profitAndLoss.totals.netProfit !== beforeStatements.profitAndLoss.totals.netProfit) {
      throw new Error("P&L changed after an original journal and its reversal");
    }
    if (afterStatements.balanceSheet.totals.difference !== beforeStatements.balanceSheet.totals.difference) {
      throw new Error("Balance Sheet equation changed after an original journal and its reversal");
    }

    let duplicateBlocked = false;
    try {
      await reversePostedJournal({
        journalId: original.code,
        reversalDate: "2026-09-17",
        reason: "Duplicate reversal must be rejected",
      }, client);
    } catch (error) {
      duplicateBlocked = /already been reversed/i.test(error instanceof Error ? error.message : String(error));
    }
    if (!duplicateBlocked) throw new Error("Duplicate journal reversal was not blocked");

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      originalJournal: savedOriginal.code,
      originalStatus: savedOriginal.status,
      reversalJournal: reversal.code,
      reversalStatus: reversal.status,
      linked: reversal.reversalOfJournalId === original.id,
      earlierDateBlocked,
      glNeutralized: afterAsset === beforeAsset && afterExpense === beforeExpense,
      financialStatementsNeutralized:
        afterStatements.profitAndLoss.totals.netProfit === beforeStatements.profitAndLoss.totals.netProfit,
      duplicateReversalBlocked: duplicateBlocked,
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
