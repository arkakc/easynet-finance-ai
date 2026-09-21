process.env.SESSION_SECRET = process.env.SESSION_SECRET || "easynet-preview-session-secret-change-before-production-2026";
process.env.AUDIT_LOG_SECRET = process.env.AUDIT_LOG_SECRET || "easynet-preview-audit-secret-change-before-production-2026";

import { NextRequest } from "next/server";
import { Role as PrismaRole, UserStatus } from "@prisma/client";
import {
  PRISMA_ROLE_MAP,
  ROLE_PERMISSIONS,
  createSessionToken,
  sessionCookie,
  type SessionUser,
} from "../lib/auth";
import { POST as importChartOfAccounts } from "../app/api/ui/accounts/import/route";
import { prisma } from "../src/lib/prisma";

function cookie(user: SessionUser) {
  return `${sessionCookie.name}=${createSessionToken(user)}`;
}

function request(user: SessionUser | null, body: unknown) {
  return new NextRequest("http://localhost/api/ui/accounts/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(user ? { cookie: cookie(user) } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const suffix = String(process.pid);
  const tempEmail = `coa-readonly-${suffix}@example.test`;

  const managerRecord = await prisma.user.findFirst({
    where: { role: PrismaRole.SYSTEM_MANAGER, status: UserStatus.ACTIVE },
    orderBy: { createdAt: "asc" },
  });
  if (!managerRecord) throw new Error("No active System Manager exists for COA import UAT");

  const managerRole = PRISMA_ROLE_MAP[String(managerRecord.role)];
  if (!managerRole) throw new Error("System Manager role mapping is unavailable");
  const admin: SessionUser = {
    userId: managerRecord.id,
    email: managerRecord.email,
    name: managerRecord.name,
    roles: [managerRole],
    permissions: ROLE_PERMISSIONS[managerRole],
    sessionVersion: managerRecord.sessionVersion,
  };

  const readonly = await prisma.user.create({
    data: {
      name: "COA Import Read Only UAT",
      email: tempEmail,
      role: PrismaRole.MANAGEMENT,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
    },
  });
  const readonlyRole = PRISMA_ROLE_MAP[String(readonly.role)];
  if (!readonlyRole) throw new Error("Management role mapping is unavailable");
  const management: SessionUser = {
    userId: readonly.id,
    email: readonly.email,
    name: readonly.name,
    roles: [readonlyRole],
    permissions: ROLE_PERMISSIONS[readonlyRole],
    sessionVersion: readonly.sessionVersion,
  };

  try {
    const unauthenticated = await importChartOfAccounts(request(null, { rows: [] }));
    if (unauthenticated.status !== 401) {
      throw new Error(`Unauthenticated import expected 401, got ${unauthenticated.status}`);
    }

    const denied = await importChartOfAccounts(request(management, { rows: [] }));
    if (denied.status !== 403) {
      throw new Error(`Read-only role import expected 403, got ${denied.status}`);
    }

    const invalid = await importChartOfAccounts(request(admin, {
      rows: [{ code: "UAT-INVALID", name: "Missing type" }],
    }));
    if (invalid.status !== 400) {
      throw new Error(`Invalid import expected 400, got ${invalid.status}`);
    }

    const beforeCount = await prisma.chartOfAccounts.count();
    const duplicate = await importChartOfAccounts(request(admin, {
      rows: [
        { code: "UAT-DUPLICATE", name: "Duplicate A", type: "ASSET" },
        { code: "UAT-DUPLICATE", name: "Duplicate B", type: "ASSET" },
      ],
    }));
    if (duplicate.status !== 400) {
      throw new Error(`Duplicate-code import expected 400, got ${duplicate.status}`);
    }
    const afterCount = await prisma.chartOfAccounts.count();
    if (beforeCount !== afterCount) {
      throw new Error(`Rejected duplicate import changed account count (${beforeCount} -> ${afterCount})`);
    }

    const accounts = await prisma.chartOfAccounts.findMany({
      select: { id: true, code: true, parentId: true },
    });
    if (accounts.length === 0) throw new Error("No Chart of Accounts records found");

    const codes = new Set(accounts.map((account) => account.code));
    if (codes.size !== accounts.length) throw new Error("Chart of Accounts contains duplicate codes");

    const byId = new Map(accounts.map((account) => [account.id, account]));
    const orphanParents = accounts.filter((account) => account.parentId && !byId.has(account.parentId));
    if (orphanParents.length) {
      throw new Error(`Chart of Accounts contains ${orphanParents.length} orphan parent links`);
    }

    for (const account of accounts) {
      const seen = new Set<string>();
      let current = account;
      while (current.parentId) {
        if (seen.has(current.id)) {
          throw new Error(`Chart of Accounts contains a cycle at ${account.code}`);
        }
        seen.add(current.id);
        const parent = byId.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
    }

    const roots = accounts.filter((account) => !account.parentId).length;
    if (roots === 0) throw new Error("Chart of Accounts has no root accounts");

    console.log(JSON.stringify({
      execution: "direct route handler",
      liveBusinessDataChanged: false,
      unauthenticated: unauthenticated.status,
      nonAdmin: denied.status,
      invalidPayload: invalid.status,
      duplicatePayload: duplicate.status,
      accounts: accounts.length,
      rootAccounts: roots,
      duplicateCodes: accounts.length - codes.size,
      orphanParents: orphanParents.length,
      dbValidatedRbac: true,
    }, null, 2));
  } finally {
    await prisma.authThrottle.deleteMany({
      where: { keyHash: { contains: "" } },
    }).catch(() => undefined);
    await prisma.user.delete({ where: { id: readonly.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
