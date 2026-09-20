process.env.SESSION_SECRET = process.env.SESSION_SECRET || "easynet-preview-session-secret-change-before-production-2026";

import type { SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const { prisma } = await import("../src/lib/prisma");

  const admin: SessionUser = {
    email: "admin@easynet.local",
    name: "UAT Admin",
    roles: ["System Manager"],
    permissions: ROLE_PERMISSIONS["System Manager"],
  };
  const management: SessionUser = {
    email: "willie@easynet.local",
    name: "UAT Management",
    roles: ["Management"],
    permissions: ROLE_PERMISSIONS["Management"],
  };
  const cookie = (user: SessionUser) => ({ Cookie: `${sessionCookie.name}=${createSessionToken(user)}` });

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/ui/accounts/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [] }),
    });
    if (unauthenticated.status !== 401) {
      throw new Error(`Unauthenticated import expected 401, got ${unauthenticated.status}`);
    }

    const denied = await fetch(`${baseUrl}/api/ui/accounts/import`, {
      method: "POST",
      headers: { ...cookie(management), "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [] }),
    });
    if (denied.status !== 403) {
      throw new Error(`Read-only role import expected 403, got ${denied.status}`);
    }

    const invalid = await fetch(`${baseUrl}/api/ui/accounts/import`, {
      method: "POST",
      headers: { ...cookie(admin), "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [{ code: "UAT-INVALID", name: "Missing type" }] }),
    });
    if (invalid.status !== 400) {
      throw new Error(`Invalid import expected 400, got ${invalid.status}`);
    }

    const beforeCount = await prisma.chartOfAccounts.count();
    const duplicate = await fetch(`${baseUrl}/api/ui/accounts/import`, {
      method: "POST",
      headers: { ...cookie(admin), "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          { code: "UAT-DUPLICATE", name: "Duplicate A", type: "ASSET" },
          { code: "UAT-DUPLICATE", name: "Duplicate B", type: "ASSET" },
        ],
      }),
    });
    if (duplicate.status !== 400) {
      throw new Error(`Duplicate-code import expected 400, got ${duplicate.status}`);
    }
    const afterCount = await prisma.chartOfAccounts.count();
    if (beforeCount !== afterCount) {
      throw new Error(`Rejected duplicate import changed account count (${beforeCount} -> ${afterCount})`);
    }

    const accounts = await prisma.chartOfAccounts.findMany({ select: { id: true, code: true, parentId: true } });
    if (accounts.length === 0) throw new Error("No imported Chart of Accounts records found");
    const codes = new Set(accounts.map((account) => account.code));
    if (codes.size !== accounts.length) throw new Error("Imported Chart of Accounts contains duplicate codes");
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const orphanParents = accounts.filter((account) => account.parentId && !byId.has(account.parentId));
    if (orphanParents.length) throw new Error(`Imported Chart of Accounts contains ${orphanParents.length} orphan parent links`);
    for (const account of accounts) {
      const seen = new Set<string>();
      let current = account;
      while (current.parentId) {
        if (seen.has(current.id)) throw new Error(`Imported Chart of Accounts contains a cycle at ${account.code}`);
        seen.add(current.id);
        const parent = byId.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
    }
    const roots = accounts.filter((account) => !account.parentId).length;
    if (roots === 0) throw new Error("Imported Chart of Accounts has no root accounts");

    console.log(JSON.stringify({
      database: "live read-only",
      liveDatabaseChanged: false,
      baseUrl,
      unauthenticated: unauthenticated.status,
      nonAdmin: denied.status,
      invalidPayload: invalid.status,
      duplicatePayload: duplicate.status,
      importedAccounts: accounts.length,
      rootAccounts: roots,
      duplicateCodes: accounts.length - codes.size,
      orphanParents: orphanParents.length,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
