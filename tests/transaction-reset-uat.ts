import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  JournalStatus,
  PrismaClient,
  Role as PrismaRole,
  UserStatus,
} from "@prisma/client";
import { deleteCompanyTransactions, getCompanyTransactionsSummary } from "../lib/company/delete-transactions";
import { verifyAuditIntegrity } from "../lib/security/audit";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";

async function main() {
  await verifyLiveDatabase();

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-transaction-reset-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);

  const client = new PrismaClient({
    datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}`,
  });

  try {
    const suffix = String(process.pid);
    const manager = await client.user.create({
      data: {
        name: "Phase 9 Transaction Reset Manager",
        email: `phase9-transaction-reset-${suffix}@example.test`,
        role: PrismaRole.SYSTEM_MANAGER,
        status: UserStatus.ACTIVE,
        sessionVersion: 1,
      },
    });
    const debitAccount = await client.chartOfAccounts.create({
      data: {
        code: `UAT9-TR-DR-${suffix}`,
        name: "Transaction Reset Debit",
        type: AccountTypeGL.ASSET,
      },
    });
    const creditAccount = await client.chartOfAccounts.create({
      data: {
        code: `UAT9-TR-CR-${suffix}`,
        name: "Transaction Reset Credit",
        type: AccountTypeGL.EQUITY,
        normalBalance: "CREDIT",
      },
    });

    await client.journalHeader.create({
      data: {
        code: `UAT9-JRN-${suffix}`,
        date: new Date("2026-01-15T00:00:00+10:00"),
        description: "Phase 9 transaction reset fixture",
        sourceDocType: "UAT",
        sourceDocId: `UAT9-TR-${suffix}`,
        status: JournalStatus.POSTED,
        currency: "PGK",
        baseCurrency: "PGK",
        exchangeRate: 1,
        totalDebit: 25,
        totalCredit: 25,
        transactionTotalDebit: 25,
        transactionTotalCredit: 25,
        isBalanced: true,
        createdBy: manager.email,
        approvedBy: manager.email,
        approvedAt: new Date(),
        postedAt: new Date(),
        lines: {
          create: [
            {
              lineNo: 1,
              accountId: debitAccount.id,
              description: "UAT debit",
              debit: 25,
              credit: 0,
              amount: 25,
              currency: "PGK",
              transactionCurrency: "PGK",
              exchangeRate: 1,
              transactionDebit: 25,
              transactionCredit: 0,
              transactionAmount: 25,
            },
            {
              lineNo: 2,
              accountId: creditAccount.id,
              description: "UAT credit",
              debit: 0,
              credit: 25,
              amount: 25,
              currency: "PGK",
              transactionCurrency: "PGK",
              exchangeRate: 1,
              transactionDebit: 0,
              transactionCredit: 25,
              transactionAmount: 25,
            },
          ],
        },
      },
    });

    const [before, masterBefore] = await Promise.all([
      getCompanyTransactionsSummary(client),
      Promise.all([
        client.chartOfAccounts.count(),
        client.customer.count(),
        client.supplier.count(),
        client.item.count(),
        client.bankAccount.count(),
        client.taxCode.count(),
        client.user.count(),
      ]),
    ]);
    if (before.totalTransactions === 0) {
      throw new Error("Transaction reset fixture did not create transactional data");
    }

    const result = await client.$transaction((tx) => deleteCompanyTransactions({
      adminUserId: manager.id,
      adminEmail: manager.email,
      adminName: manager.name,
      requestId: `phase9-transaction-reset-${suffix}`,
      transactionClient: tx,
    }));

    const [after, masterAfter, stockAfter, audit, integrity] = await Promise.all([
      getCompanyTransactionsSummary(client),
      Promise.all([
        client.chartOfAccounts.count(),
        client.customer.count(),
        client.supplier.count(),
        client.item.count(),
        client.bankAccount.count(),
        client.taxCode.count(),
        client.user.count(),
      ]),
      client.stockLevel.aggregate({ _sum: { quantity: true, reserved: true, available: true } }),
      client.auditLog.findUnique({ where: { id: result.auditId } }),
      verifyAuditIntegrity(client),
    ]);

    const transactionFields = Object.entries(after).filter(([key]) => key !== "totalTransactions");
    if (transactionFields.some(([, value]) => value !== 0) || after.totalTransactions !== 0) {
      throw new Error(`Transaction records remain after reset: ${JSON.stringify(after)}`);
    }
    if (JSON.stringify(masterBefore) !== JSON.stringify(masterAfter)) {
      throw new Error("Master data changed during transaction reset");
    }
    if (
      Number(stockAfter._sum.quantity || 0) !== 0
      || Number(stockAfter._sum.reserved || 0) !== 0
      || Number(stockAfter._sum.available || 0) !== 0
    ) {
      throw new Error("Stock quantities were not reset");
    }
    if (
      !audit
      || audit.userId !== manager.id
      || !audit.integrityHash
      || !audit.sequence
    ) {
      throw new Error("Transaction reset did not create a sealed administrator audit event");
    }
    if (!integrity.valid) {
      throw new Error("Transaction reset broke audit-chain integrity");
    }

    console.log(JSON.stringify({
      database: "temporary current-schema clone",
      liveDatabaseChanged: false,
      beforeTransactions: before.totalTransactions,
      afterTransactions: after.totalTransactions,
      masterDataPreserved: true,
      stockQuantitiesReset: true,
      resetAuditSealed: Boolean(audit.integrityHash),
      auditSequence: audit.sequence,
      auditIntegrityValid: integrity.valid,
    }, null, 2));
  } finally {
    await client.$disconnect();
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
