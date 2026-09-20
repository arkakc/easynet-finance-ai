import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { deleteCompanyMasterData } from "../lib/company/delete-master-data";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";

async function main() {
  await verifyLiveDatabase();
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-master-reset-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });
  try {
    const admin = await client.user.findUnique({ where: { email: "admin@easynet.local" } });
    const otherUser = await client.user.findFirst({ where: { id: { not: admin?.id || "" } } });
    const account = await client.chartOfAccounts.findFirst();
    if (!admin || !otherUser || !account) throw new Error("UAT requires seeded admin, second user and chart account");

    const marker = `UAT-${Date.now()}`;
    await client.budget.create({ data: { code: `${marker}-BUD`, fiscalYear: 2026, period: "YEARLY", budgetAmount: 1, actualAmount: 0, variance: 1, variancePercent: 100, accountId: account.id, createdBy: otherUser.id } });
    await client.document.create({ data: { code: `${marker}-DOC`, type: "CERTIFICATE", name: "UAT retained certificate", createdBy: otherUser.id } });
    await client.auditLog.create({ data: { action: "UAT", entityType: "UAT", entityCode: marker, description: "UAT foreign-key coverage", userId: otherUser.id } });

    const result = await deleteCompanyMasterData({ adminEmail: admin.email, adminName: "Master reset UAT", preserveAdminUser: true, database: client });
    const [users, budgets, retainedDocument, auditRows, adminAfter] = await Promise.all([
      client.user.count(),
      client.budget.count(),
      client.document.findUnique({ where: { code: `${marker}-DOC` }, select: { createdBy: true } }),
      client.auditLog.findMany({ select: { userId: true } }),
      client.user.findUnique({ where: { email: admin.email }, select: { id: true } }),
    ]);
    if (users !== 1 || !adminAfter || budgets !== 0) throw new Error("Factory reset did not leave exactly one admin or clear budgets");
    if (!retainedDocument || retainedDocument.createdBy !== adminAfter.id) throw new Error("Retained document creator was not reassigned to the preserved admin");
    if (auditRows.some((row) => row.userId !== adminAfter.id)) throw new Error("Audit logs still reference deleted users");

    console.log(JSON.stringify({ database: "temporary clone", liveDatabaseChanged: false, auditId: result.auditId, preservedUsers: users, budgetsRemaining: budgets, retainedDocumentReassigned: true, auditForeignKeysValid: true }, null, 2));
  } finally {
    await client.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
