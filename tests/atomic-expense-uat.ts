import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountTypeGL, NormalBalance } from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-expense-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);

  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { finalizeExpenseAtomic },
    { prismaAppendRecord, prismaFindRecords, prismaUpdateRecord },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-expense"),
    import("../lib/backend/prisma-store"),
    import("../src/lib/prisma"),
  ]);

  try {
    const account = async (
      code: string,
      name: string,
      type: AccountTypeGL,
      normalBalance: NormalBalance,
    ) => prisma.chartOfAccounts.upsert({
      where: { code },
      update: { name, type, normalBalance, parentId: null, isActive: true },
      create: { code, name, type, normalBalance, isActive: true },
    });

    const [expenseAccount, bankAccount] = await Promise.all([
      account("UAT-EXP-COST", "UAT Atomic Expense Cost", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
      account("UAT-EXP-BANK", "UAT Atomic Expense Bank", AccountTypeGL.ASSET, NormalBalance.DEBIT),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const expenseId = `UAT-EXP-${process.pid}`;
    const created = await prismaAppendRecord<any>("Expenses", {
      expenseId,
      expenseNumber: expenseId,
      expenseDate: "2099-04-05",
      expenseAccountId: `ACC-${expenseAccount.code}`,
      description: "UAT Atomic Expense",
      netAmount: 80,
      gstAmount: 0,
      totalAmount: 80,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bankAccount.code}`,
      status: "DRAFT",
    }, "atomic-expense-uat");

    if (created.status !== "DRAFT") throw new Error("Expense did not persist as DRAFT");
    if (created.expenseAccountId !== `ACC-${expenseAccount.code}`) {
      throw new Error("Expense account was not persisted");
    }
    if (created.cashBankAccountId !== `ACC-${bankAccount.code}`) {
      throw new Error("Cash / bank account was not persisted");
    }

    let failedPostingRolledBack = false;
    try {
      await finalizeExpenseAtomic({
        expenseId,
        postingDate: "2099-04-05",
        documentNumber: expenseId,
        reference: "UAT expense failure",
        expenseAccountId: `ACC-${expenseAccount.code}`,
        cashBankAccountId: "ACC-UAT-EXP-MISSING-BANK",
        approveIfDraft: true,
        createdBy: "atomic-expense-uat",
        approvedBy: "atomic-expense-uat",
      });
    } catch (error) {
      failedPostingRolledBack = /missing accounts/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!failedPostingRolledBack) throw new Error("Invalid Expense posting did not fail as expected");

    const [expenseAfterFailure, journalAfterFailure] = await Promise.all([
      prisma.expense.findFirst({ where: { OR: [{ id: expenseId }, { code: expenseId }] } }),
      prisma.journalHeader.findFirst({ where: { sourceDocType: "EXPENSE", sourceDocId: expenseId } }),
    ]);
    if (
      !expenseAfterFailure
      || expenseAfterFailure.glPosted
      || expenseAfterFailure.journalId
      || expenseAfterFailure.approvedAt
      || expenseAfterFailure.approvedBy
    ) {
      throw new Error("Expense approval or GL state survived a failed atomic posting");
    }
    if (journalAfterFailure) throw new Error("Journal survived a failed atomic Expense posting");

    const success = await finalizeExpenseAtomic({
      expenseId,
      postingDate: "2099-04-05",
      documentNumber: expenseId,
      reference: "UAT expense success",
      expenseAccountId: `ACC-${expenseAccount.code}`,
      cashBankAccountId: `ACC-${bankAccount.code}`,
      approveIfDraft: true,
      createdBy: "atomic-expense-uat",
      approvedBy: "atomic-expense-uat",
    });

    const [committedExpense, committedJournal, mappedRows] = await Promise.all([
      prisma.expense.findFirst({ where: { OR: [{ id: expenseId }, { code: expenseId }] } }),
      prisma.journalHeader.findUnique({
        where: { code: success.journalId },
        include: { lines: { include: { account: true } } },
      }),
      prismaFindRecords<any>("Expenses", { expenseId }, 1),
    ]);

    if (
      !committedExpense
      || !committedExpense.glPosted
      || !committedExpense.approvedAt
      || committedExpense.journalId !== success.journalId
    ) {
      throw new Error("Expense approval and posting did not commit atomically");
    }
    if (
      !committedJournal
      || committedJournal.status !== "POSTED"
      || Number(committedJournal.totalDebit) !== 80
      || Number(committedJournal.totalCredit) !== 80
      || committedJournal.lines.length !== 2
    ) {
      throw new Error("Expense journal was not committed correctly");
    }
    if (mappedRows[0]?.status !== "POSTED") {
      throw new Error("Expense mapper did not expose POSTED state");
    }

    const duplicate = await finalizeExpenseAtomic({
      expenseId,
      postingDate: "2099-04-05",
      documentNumber: expenseId,
      expenseAccountId: `ACC-${expenseAccount.code}`,
      cashBankAccountId: `ACC-${bankAccount.code}`,
      approveIfDraft: true,
    });
    const journalCount = await prisma.journalHeader.count({
      where: { sourceDocType: "EXPENSE", sourceDocId: expenseId },
    });
    if (!duplicate.alreadyPosted || journalCount !== 1) {
      throw new Error("Duplicate Expense posting was not idempotent");
    }

    const cancelledId = `UAT-EXP-CANCEL-${process.pid}`;
    await prismaAppendRecord<any>("Expenses", {
      expenseId: cancelledId,
      expenseNumber: cancelledId,
      expenseDate: "2099-04-06",
      expenseAccountId: `ACC-${expenseAccount.code}`,
      description: "UAT Cancelled Expense",
      netAmount: 10,
      gstAmount: 0,
      totalAmount: 10,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bankAccount.code}`,
      status: "DRAFT",
    }, "atomic-expense-uat");
    await prismaUpdateRecord<any>(
      "Expenses",
      "expenseId",
      cancelledId,
      { status: "CANCELLED" },
      "atomic-expense-uat",
    );
    const cancelled = await prismaFindRecords<any>("Expenses", { expenseId: cancelledId }, 1);
    if (cancelled[0]?.status !== "CANCELLED") {
      throw new Error("Expense cancellation workflow state was not persisted");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      expenseCreationPersisted: created.status === "DRAFT",
      expenseAccountPersisted: created.expenseAccountId === `ACC-${expenseAccount.code}`,
      cashBankAccountPersisted: created.cashBankAccountId === `ACC-${bankAccount.code}`,
      failedPostingRolledBack,
      failedApprovalRolledBack: !expenseAfterFailure.approvedAt && !expenseAfterFailure.approvedBy,
      failedGlStateRolledBack: !expenseAfterFailure.glPosted && !expenseAfterFailure.journalId,
      failedJournalRolledBack: journalAfterFailure === null,
      successfulApprovalCommitted: Boolean(committedExpense.approvedAt),
      successfulExpenseCommitted: committedExpense.glPosted === true,
      successfulJournalCommitted: committedJournal.status === "POSTED",
      successfulJournalBalanced: Number(committedJournal.totalDebit) === Number(committedJournal.totalCredit),
      expenseJournalLinked: committedExpense.journalId === committedJournal.code,
      duplicatePostingBlocked: duplicate.alreadyPosted === true && journalCount === 1,
      cancellationStatePersisted: cancelled[0]?.status === "CANCELLED",
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
      throw new Error("Unsafe UAT cleanup path");
    }
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
