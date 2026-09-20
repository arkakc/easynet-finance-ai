import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  NormalBalance,
  Role,
  UserStatus,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-manual-journal-approval-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    {
      createPendingManualJournal,
      approvePendingManualJournal,
      rejectPendingManualJournal,
    },
    { buildFinancialStatements },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/manual-journal-approval"),
    import("../lib/accounting/financial-statements"),
    import("../src/lib/prisma"),
  ]);

  try {
    const suffix = String(process.pid);
    const makerEmail = `uat-maker-${suffix}@easynet.local`;
    const checkerEmail = `uat-checker-${suffix}@easynet.local`;

    const [maker, checker] = await Promise.all([
      prisma.user.create({
        data: {
          email: makerEmail,
          name: "UAT Accounts Maker",
          role: Role.ACCOUNTS_USER,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          email: checkerEmail,
          name: "UAT Finance Checker",
          role: Role.FINANCE_CONTROLLER,
          status: UserStatus.ACTIVE,
        },
      }),
    ]);

    const [debitAccount, creditAccount] = await Promise.all([
      prisma.chartOfAccounts.create({
        data: {
          code: `UATMJDR${suffix}`,
          name: "UAT Manual Journal Debit",
          type: AccountTypeGL.ASSET,
          normalBalance: NormalBalance.DEBIT,
          isActive: true,
        },
      }),
      prisma.chartOfAccounts.create({
        data: {
          code: `UATMJCR${suffix}`,
          name: "UAT Manual Journal Credit",
          type: AccountTypeGL.EQUITY,
          normalBalance: NormalBalance.CREDIT,
          isActive: true,
        },
      }),
    ]);

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2099-01-01" },
      update: { value: "2099-01-01" },
    });

    const statementInput = { from: "2099-09-01", asOf: "2099-09-30" };
    const before = await buildFinancialStatements(statementInput, prisma);

    const pending = await createPendingManualJournal({
      entryType: "JOURNAL_ENTRY",
      journalType: "GENERAL_JOURNAL",
      postingDate: "2099-09-15",
      reference: "UAT maker-checker manual journal",
      remarks: "Must remain outside GL until checker approval",
      makerEmail,
      manualId: `UAT-MANUAL-${suffix}`,
      journalId: `UAT-MJ-${suffix}`,
      lines: [
        {
          accountId: `ACC-${debitAccount.code}`,
          debit: 100,
          credit: 0,
          description: "UAT debit",
        },
        {
          accountId: `ACC-${creditAccount.code}`,
          debit: 0,
          credit: 100,
          description: "UAT credit",
        },
      ],
    });

    const [pendingRow, pendingAudit, afterPending] = await Promise.all([
      prisma.journalHeader.findUnique({
        where: { code: pending.journalId },
        include: { lines: true },
      }),
      prisma.auditLog.findMany({
        where: { entityType: "Journal", entityCode: pending.journalId },
        orderBy: { createdAt: "asc" },
      }),
      buildFinancialStatements(statementInput, prisma),
    ]);

    if (
      !pendingRow
      || pendingRow.status !== "PENDING"
      || pendingRow.approvedBy
      || pendingRow.approvedAt
      || pendingRow.postedAt
    ) {
      throw new Error("Manual journal did not remain PENDING before checker approval");
    }
    if (
      afterPending.controls.periodLedger.debit !== before.controls.periodLedger.debit
      || afterPending.controls.periodLedger.credit !== before.controls.periodLedger.credit
    ) {
      throw new Error("PENDING manual journal affected financial statements");
    }
    if (pendingAudit.length !== 1 || pendingAudit[0].action !== "SUBMIT_FOR_APPROVAL") {
      throw new Error("Maker submission audit trail is missing");
    }

    let selfApprovalBlocked = false;
    try {
      await approvePendingManualJournal({
        journalId: pending.journalId,
        checkerEmail: maker.email,
        note: "Maker must not approve own journal",
      }, prisma);
    } catch (error) {
      selfApprovalBlocked = /creator cannot approve their own/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!selfApprovalBlocked) throw new Error("Maker was able to approve their own manual journal");

    await prisma.chartOfAccounts.update({
      where: { id: debitAccount.id },
      data: { isActive: false },
    });

    let approvalRevalidationBlocked = false;
    try {
      await approvePendingManualJournal({
        journalId: pending.journalId,
        checkerEmail: checker.email,
        note: "Should fail while account is inactive",
      }, prisma);
    } catch (error) {
      approvalRevalidationBlocked = /inactive accounts/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!approvalRevalidationBlocked) {
      throw new Error("Checker approval did not revalidate account state");
    }

    const afterFailedApproval = await prisma.journalHeader.findUnique({
      where: { code: pending.journalId },
    });
    if (
      !afterFailedApproval
      || afterFailedApproval.status !== "PENDING"
      || afterFailedApproval.approvedAt
      || afterFailedApproval.postedAt
    ) {
      throw new Error("Failed checker approval did not roll back journal state");
    }

    await prisma.chartOfAccounts.update({
      where: { id: debitAccount.id },
      data: { isActive: true },
    });

    const approved = await approvePendingManualJournal({
      journalId: pending.journalId,
      checkerEmail: checker.email,
      note: "UAT checker approval",
    }, prisma);

    const [postedRow, postedAudits, afterApproval] = await Promise.all([
      prisma.journalHeader.findUnique({
        where: { code: pending.journalId },
        include: { lines: true },
      }),
      prisma.auditLog.findMany({
        where: { entityType: "Journal", entityCode: pending.journalId },
        orderBy: { createdAt: "asc" },
      }),
      buildFinancialStatements(statementInput, prisma),
    ]);

    if (
      !postedRow
      || postedRow.status !== "POSTED"
      || postedRow.createdBy !== makerEmail
      || postedRow.approvedBy !== checkerEmail
      || !postedRow.approvedAt
      || !postedRow.postedAt
    ) {
      throw new Error("Checker approval did not post the manual journal correctly");
    }

    const debitDelta = Number(
      (afterApproval.controls.periodLedger.debit - before.controls.periodLedger.debit).toFixed(2),
    );
    const creditDelta = Number(
      (afterApproval.controls.periodLedger.credit - before.controls.periodLedger.credit).toFixed(2),
    );
    if (debitDelta !== 100 || creditDelta !== 100) {
      throw new Error("Approved manual journal did not enter the GL exactly once");
    }
    if (
      postedAudits.length !== 2
      || postedAudits[0].action !== "SUBMIT_FOR_APPROVAL"
      || postedAudits[1].action !== "APPROVE_POST"
    ) {
      throw new Error("Maker-checker approval audit trail is incomplete");
    }

    let duplicateApprovalBlocked = false;
    try {
      await approvePendingManualJournal({
        journalId: pending.journalId,
        checkerEmail,
        note: "Duplicate approval attempt",
      }, prisma);
    } catch (error) {
      duplicateApprovalBlocked = /only PENDING manual journals can be approved/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!duplicateApprovalBlocked) {
      throw new Error("Posted manual journal could be approved twice");
    }

    const rejectedPending = await createPendingManualJournal({
      entryType: "JOURNAL_ENTRY",
      journalType: "GENERAL_JOURNAL",
      postingDate: "2099-09-16",
      reference: "UAT rejected manual journal",
      makerEmail,
      manualId: `UAT-MANUAL-REJECT-${suffix}`,
      journalId: `UAT-MJ-REJECT-${suffix}`,
      lines: [
        {
          accountId: `ACC-${debitAccount.code}`,
          debit: 50,
          credit: 0,
          description: "Rejected debit",
        },
        {
          accountId: `ACC-${creditAccount.code}`,
          debit: 0,
          credit: 50,
          description: "Rejected credit",
        },
      ],
    });

    const rejected = await rejectPendingManualJournal({
      journalId: rejectedPending.journalId,
      checkerEmail,
      note: "Supporting evidence is insufficient",
    }, prisma);

    const [rejectedRow, rejectedAudits, afterRejection] = await Promise.all([
      prisma.journalHeader.findUnique({ where: { code: rejectedPending.journalId } }),
      prisma.auditLog.findMany({
        where: { entityType: "Journal", entityCode: rejectedPending.journalId },
        orderBy: { createdAt: "asc" },
      }),
      buildFinancialStatements(statementInput, prisma),
    ]);

    if (
      !rejectedRow
      || rejectedRow.status !== "CANCELLED"
      || rejectedRow.approvedBy
      || rejectedRow.approvedAt
      || rejectedRow.postedAt
    ) {
      throw new Error("Rejected manual journal has an invalid lifecycle state");
    }
    if (
      afterRejection.controls.periodLedger.debit !== afterApproval.controls.periodLedger.debit
      || afterRejection.controls.periodLedger.credit !== afterApproval.controls.periodLedger.credit
    ) {
      throw new Error("Rejected manual journal affected the GL");
    }
    if (
      rejectedAudits.length !== 2
      || rejectedAudits[0].action !== "SUBMIT_FOR_APPROVAL"
      || rejectedAudits[1].action !== "REJECT"
    ) {
      throw new Error("Rejection audit trail is incomplete");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      pendingCreated: pendingRow.status === "PENDING",
      pendingHasNoApprovalMetadata: !pendingRow.approvedAt && !pendingRow.postedAt,
      pendingHasNoGlEffect:
        afterPending.controls.periodLedger.debit === before.controls.periodLedger.debit
        && afterPending.controls.periodLedger.credit === before.controls.periodLedger.credit,
      makerSubmissionAudited: pendingAudit[0]?.action === "SUBMIT_FOR_APPROVAL",
      selfApprovalBlocked,
      approvalRevalidationBlocked,
      failedApprovalRolledBack: afterFailedApproval.status === "PENDING",
      checkerApprovalCommitted: approved.status === "POSTED" && postedRow.status === "POSTED",
      makerCheckerSeparated: postedRow.createdBy === makerEmail && postedRow.approvedBy === checkerEmail,
      approvedJournalEnteredGlOnce: debitDelta === 100 && creditDelta === 100,
      approvalAudited: postedAudits[1]?.action === "APPROVE_POST",
      duplicateApprovalBlocked,
      rejectionCommitted: rejected.status === "CANCELLED" && rejectedRow.status === "CANCELLED",
      rejectedJournalHasNoGlEffect:
        afterRejection.controls.periodLedger.debit === afterApproval.controls.periodLedger.debit
        && afterRejection.controls.periodLedger.credit === afterApproval.controls.periodLedger.credit,
      rejectionAudited: rejectedAudits[1]?.action === "REJECT",
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolved = path.resolve(temporaryRoot);
    const root = path.resolve(os.tmpdir());
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
