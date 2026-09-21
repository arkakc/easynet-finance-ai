import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  PrismaClient,
  Role as PrismaRole,
  UserStatus,
} from "@prisma/client";
import { deleteCompanyMasterData } from "../lib/company/delete-master-data";
import { verifyAuditIntegrity } from "../lib/security/audit";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";

async function main() {
  await verifyLiveDatabase();
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-master-reset-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });

  try {
    const suffix = String(process.pid);
    const manager = await client.user.create({
      data: {
        name: "Phase 9 Factory Reset Manager",
        email: `phase9-reset-manager-${suffix}@example.test`,
        role: PrismaRole.SYSTEM_MANAGER,
        status: UserStatus.ACTIVE,
        sessionVersion: 1,
      },
    });
    const otherUser = await client.user.create({
      data: {
        name: "Phase 9 Factory Reset Secondary User",
        email: `phase9-reset-user-${suffix}@example.test`,
        role: PrismaRole.ACCOUNTS_USER,
        status: UserStatus.ACTIVE,
        sessionVersion: 1,
      },
    });
    const account = await client.chartOfAccounts.create({
      data: {
        code: `UAT9-RESET-${suffix}`,
        name: "Phase 9 Reset Test Account",
        type: AccountTypeGL.ASSET,
        currency: "PGK",
      },
    });

    const marker = `UAT9-${suffix}`;
    await client.budget.create({
      data: {
        code: `${marker}-BUD`,
        fiscalYear: 2026,
        period: "YEARLY",
        budgetAmount: 1,
        actualAmount: 0,
        variance: 1,
        variancePercent: 100,
        accountId: account.id,
        createdBy: otherUser.id,
      },
    });
    await client.document.create({
      data: {
        code: `${marker}-DOC`,
        type: "CERTIFICATE",
        name: "UAT reset source document",
        createdBy: otherUser.id,
      },
    });
    const legacyAudit = await client.auditLog.create({
      data: {
        action: "UAT_LEGACY",
        entityType: "UAT",
        entityCode: marker,
        description: "Legacy unsealed audit FK coverage",
        userId: otherUser.id,
        actorEmail: otherUser.email,
      },
    });

    const result = await deleteCompanyMasterData({
      adminUserId: manager.id,
      adminEmail: manager.email,
      adminName: manager.name,
      preserveAdminUser: true,
      requestId: `phase9-master-reset-${suffix}`,
      database: client,
    });

    const [
      users,
      budgets,
      documents,
      managerAfter,
      otherAfter,
      legacyAfter,
      resetAudit,
      integrity,
    ] = await Promise.all([
      client.user.count(),
      client.budget.count(),
      client.document.count(),
      client.user.findUnique({ where: { id: manager.id } }),
      client.user.findUnique({ where: { id: otherUser.id } }),
      client.auditLog.findUnique({ where: { id: legacyAudit.id } }),
      client.auditLog.findUnique({ where: { id: result.auditId } }),
      verifyAuditIntegrity(client),
    ]);

    if (users !== 1 || !managerAfter || otherAfter) {
      throw new Error("Factory reset did not preserve exactly the authenticated System Manager");
    }
    if (budgets !== 0 || documents !== 0) {
      throw new Error("Factory reset left master/document records behind");
    }
    if (!legacyAfter || legacyAfter.userId !== null || legacyAfter.actorEmail !== otherUser.email) {
      throw new Error("Legacy audit actor snapshot did not survive deleted-user FK cleanup");
    }
    if (
      !resetAudit
      || resetAudit.userId !== manager.id
      || !resetAudit.integrityHash
      || !resetAudit.sequence
    ) {
      throw new Error("Factory reset did not create a sealed audit event for the preserved manager");
    }
    if (!integrity.valid || integrity.sealedEntries < 2) {
      throw new Error("Factory reset broke the Phase 9 audit integrity chain");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      auditId: result.auditId,
      preservedUsers: users,
      preservedManager: managerAfter.email,
      budgetsRemaining: budgets,
      documentsRemaining: documents,
      deletedActorFkCleared: legacyAfter.userId === null,
      deletedActorSnapshotPreserved: legacyAfter.actorEmail === otherUser.email,
      resetAuditSealed: Boolean(resetAudit.integrityHash),
      auditIntegrityValid: integrity.valid,
      sealedAuditEvents: integrity.sealedEntries,
      legacyUnsealedEvents: integrity.legacyUnsealedEntries,
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
