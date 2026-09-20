import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { deleteCompanyTransactions, getCompanyTransactionsSummary } from "../lib/company/delete-transactions";
import { databaseBackupDirectory, listDatabaseBackups, resolveBackupPath, verifyDatabaseBackup } from "../lib/system/database-backup";

async function main() {
  const backups = await listDatabaseBackups();
  const source = backups.find((backup) => backup.manifestPresent);
  if (!source) throw new Error("UAT requires a verified database backup");
  await verifyDatabaseBackup(source.fileName);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-transaction-reset-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(resolveBackupPath(source.fileName), temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });
  try {
    const [admin, before, masterBefore, stockBefore] = await Promise.all([
      client.user.findUnique({ where: { email: "admin@easynet.local" }, select: { id: true, email: true } }),
      getCompanyTransactionsSummary(client),
      Promise.all([client.chartOfAccounts.count(), client.customer.count(), client.supplier.count(), client.item.count(), client.bankAccount.count(), client.taxCode.count(), client.user.count()]),
      client.stockLevel.aggregate({ _sum: { quantity: true, reserved: true, available: true } }),
    ]);
    if (!admin || before.totalTransactions === 0) throw new Error("UAT backup must contain an admin and transaction records");

    const result = await client.$transaction((tx) => deleteCompanyTransactions({ adminEmail: admin.email, adminName: "Transaction reset UAT", transactionClient: tx }));
    const [after, masterAfter, stockAfter, audit] = await Promise.all([
      getCompanyTransactionsSummary(client),
      Promise.all([client.chartOfAccounts.count(), client.customer.count(), client.supplier.count(), client.item.count(), client.bankAccount.count(), client.taxCode.count(), client.user.count()]),
      client.stockLevel.aggregate({ _sum: { quantity: true, reserved: true, available: true } }),
      client.auditLog.findUnique({ where: { id: result.auditId }, select: { userId: true } }),
    ]);
    const transactionFields = Object.entries(after).filter(([key]) => key !== "totalTransactions");
    if (transactionFields.some(([, value]) => value !== 0) || after.totalTransactions !== 0) throw new Error(`Transaction records remain after reset: ${JSON.stringify(after)}`);
    if (JSON.stringify(masterBefore) !== JSON.stringify(masterAfter)) throw new Error("Master data changed during transaction reset");
    if (Number(stockAfter._sum.quantity || 0) !== 0 || Number(stockAfter._sum.reserved || 0) !== 0 || Number(stockAfter._sum.available || 0) !== 0) throw new Error("Stock quantities were not reset");
    if (audit?.userId !== admin.id) throw new Error("Reset audit log is not owned by the administrator");

    console.log(JSON.stringify({ database: "verified backup clone", source: path.basename(databaseBackupDirectory) + "/" + source.fileName, liveDatabaseChanged: false, beforeTransactions: before.totalTransactions, afterTransactions: after.totalTransactions, masterDataPreserved: true, stockQuantitiesReset: true, auditUserPreserved: true }, null, 2));
  } finally {
    await client.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
