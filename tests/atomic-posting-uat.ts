import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountTypeGL, NormalBalance } from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-atomic-posting-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);

  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [{ runAtomicAccounting }, { prisma }] = await Promise.all([
    import("../lib/accounting/atomic-posting"),
    import("../src/lib/prisma"),
  ]);

  try {
    const asset = await prisma.chartOfAccounts.upsert({
      where: { code: "UAT-ATOMIC-ASSET" },
      update: {
        name: "UAT Atomic Asset",
        type: AccountTypeGL.ASSET,
        normalBalance: NormalBalance.DEBIT,
        parentId: null,
        isActive: true,
      },
      create: {
        code: "UAT-ATOMIC-ASSET",
        name: "UAT Atomic Asset",
        type: AccountTypeGL.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isActive: true,
      },
    });
    const revenue = await prisma.chartOfAccounts.upsert({
      where: { code: "UAT-ATOMIC-REV" },
      update: {
        name: "UAT Atomic Revenue",
        type: AccountTypeGL.REVENUE,
        normalBalance: NormalBalance.CREDIT,
        parentId: null,
        isActive: true,
      },
      create: {
        code: "UAT-ATOMIC-REV",
        name: "UAT Atomic Revenue",
        type: AccountTypeGL.REVENUE,
        normalBalance: NormalBalance.CREDIT,
        isActive: true,
      },
    });

    await prisma.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2098-12-31" },
      update: { value: "2098-12-31" },
    });

    const customerCode = `UAT-ATOMIC-CUST-${process.pid}`;
    const customer = await prisma.customer.create({
      data: {
        code: customerCode,
        name: "UAT Atomic Customer",
        isActive: true,
      },
    });

    const rollbackInvoiceCode = `UAT-ATOMIC-ROLLBACK-${process.pid}`;
    const rollbackInvoice = await prisma.invoice.create({
      data: {
        code: rollbackInvoiceCode,
        customerId: customer.id,
        issuedDate: new Date("2099-01-15T00:00:00+10:00"),
        subtotal: 88.88,
        total: 88.88,
        outstanding: 88.88,
        status: "DRAFT",
        createdBy: "atomic-posting-uat",
      },
    });

    let forcedRollbackTriggered = false;
    try {
      await runAtomicAccounting(async ({ tx, postJournal }) => {
        const journal = await postJournal({
          postingDate: "2099-01-15",
          documentType: "UAT_ATOMIC_INVOICE",
          documentId: rollbackInvoice.id,
          documentNumber: rollbackInvoice.code,
          reference: "Forced rollback proves document and GL atomicity",
          createdBy: "atomic-posting-uat",
          approvedBy: "atomic-posting-uat",
          lines: [
            { accountId: `ACC-${asset.code}`, debit: 88.88, customerId: customer.id, description: "Atomic receivable" },
            { accountId: `ACC-${revenue.code}`, credit: 88.88, customerId: customer.id, description: "Atomic revenue" },
          ],
        });

        await tx.invoice.update({
          where: { id: rollbackInvoice.id },
          data: {
            status: "SENT",
            glPosted: true,
            journalId: journal.journalId,
            approvedBy: "atomic-posting-uat",
            approvedAt: new Date(),
          },
        });

        throw new Error("UAT_FORCE_ROLLBACK");
      });
    } catch (error) {
      forcedRollbackTriggered = /UAT_FORCE_ROLLBACK/.test(error instanceof Error ? error.message : String(error));
    }
    if (!forcedRollbackTriggered) throw new Error("Forced rollback did not trigger");

    const rolledBackInvoice = await prisma.invoice.findUnique({ where: { id: rollbackInvoice.id } });
    const rolledBackJournal = await prisma.journalHeader.findFirst({
      where: { sourceDocType: "UAT_ATOMIC_INVOICE", sourceDocId: rollbackInvoice.id },
    });
    if (!rolledBackInvoice || rolledBackInvoice.status !== "DRAFT" || rolledBackInvoice.glPosted || rolledBackInvoice.journalId) {
      throw new Error("Business document changes survived a failed atomic posting");
    }
    if (rolledBackJournal) throw new Error("Journal survived a failed atomic posting");

    const successInvoiceCode = `UAT-ATOMIC-SUCCESS-${process.pid}`;
    const successInvoice = await prisma.invoice.create({
      data: {
        code: successInvoiceCode,
        customerId: customer.id,
        issuedDate: new Date("2099-01-16T00:00:00+10:00"),
        subtotal: 123.45,
        total: 123.45,
        outstanding: 123.45,
        status: "DRAFT",
        createdBy: "atomic-posting-uat",
      },
    });

    const success = await runAtomicAccounting(async ({ tx, postJournal }) => {
      const journal = await postJournal({
        postingDate: "2099-01-16",
        documentType: "UAT_ATOMIC_INVOICE",
        documentId: successInvoice.id,
        documentNumber: successInvoice.code,
        reference: "Successful atomic invoice posting",
        createdBy: "atomic-posting-uat",
        approvedBy: "atomic-posting-uat",
        lines: [
          { accountId: `ACC-${asset.code}`, debit: 123.45, customerId: customer.id, description: "Atomic receivable" },
          { accountId: `ACC-${revenue.code}`, credit: 123.45, customerId: customer.id, description: "Atomic revenue" },
        ],
      });

      await tx.invoice.update({
        where: { id: successInvoice.id },
        data: {
          status: "SENT",
          glPosted: true,
          journalId: journal.journalId,
          approvedBy: "atomic-posting-uat",
          approvedAt: new Date(),
        },
      });

      return journal;
    });

    const committedInvoice = await prisma.invoice.findUnique({ where: { id: successInvoice.id } });
    const committedJournal = await prisma.journalHeader.findUnique({
      where: { code: success.journalId },
      include: { lines: true },
    });
    if (!committedInvoice || committedInvoice.status !== "SENT" || !committedInvoice.glPosted || committedInvoice.journalId !== success.journalId) {
      throw new Error("Successful atomic posting did not commit the business document");
    }
    if (!committedJournal || committedJournal.status !== "POSTED" || committedJournal.lines.length !== 2) {
      throw new Error("Successful atomic posting did not commit the journal");
    }
    if (Number(committedJournal.totalDebit) !== 123.45 || Number(committedJournal.totalCredit) !== 123.45) {
      throw new Error("Committed journal is not balanced at the expected amount");
    }

    await prisma.globalSettings.update({
      where: { key: "posting_lock_date" },
      data: { value: "2099-01-31" },
    });

    const lockMarker = `uat_atomic_lock_marker_${process.pid}`;
    let lockedPostingBlocked = false;
    try {
      await runAtomicAccounting(async ({ tx, postJournal }) => {
        await tx.globalSettings.upsert({
          where: { key: lockMarker },
          create: { key: lockMarker, value: "must rollback" },
          update: { value: "must rollback" },
        });
        await postJournal({
          postingDate: "2099-01-31",
          documentType: "UAT_ATOMIC_LOCK",
          documentId: `UAT-LOCK-${process.pid}`,
          documentNumber: `UAT-LOCK-${process.pid}`,
          reference: "Locked posting must rollback all writes",
          lines: [
            { accountId: `ACC-${asset.code}`, debit: 1, description: "Lock debit" },
            { accountId: `ACC-${revenue.code}`, credit: 1, description: "Lock credit" },
          ],
        });
      });
    } catch (error) {
      lockedPostingBlocked = /locked through/i.test(error instanceof Error ? error.message : String(error));
    }
    if (!lockedPostingBlocked) throw new Error("Locked-period journal was not blocked");
    const markerAfterLockFailure = await prisma.globalSettings.findUnique({ where: { key: lockMarker } });
    if (markerAfterLockFailure) throw new Error("A write before a locked-period posting failure was not rolled back");

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      forcedRollbackTriggered,
      failedDocumentRolledBack: rolledBackInvoice.status === "DRAFT" && !rolledBackInvoice.glPosted,
      failedJournalRolledBack: rolledBackJournal === null,
      successfulDocumentCommitted: committedInvoice.status === "SENT" && committedInvoice.glPosted,
      successfulJournalCommitted: committedJournal.status === "POSTED",
      successfulJournalBalanced: Number(committedJournal.totalDebit) === Number(committedJournal.totalCredit),
      sourceDocumentLinkedToJournal: committedInvoice.journalId === committedJournal.code,
      lockedPostingBlocked,
      preFailureWriteRolledBack: markerAfterLockFailure === null,
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
