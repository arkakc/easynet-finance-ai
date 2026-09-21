import { NextRequest, NextResponse } from "next/server";
import { requireValidatedRequestPermission } from "@/lib/auth";
import { appendAuditEvent, requestAuditContext } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

async function checkAuth(req: Request, permission: "accounts.read" | "accounts.write") {
  return requireValidatedRequestPermission(req, permission);
}

/**
 * Infer parent account code from hierarchical account numbering.
 * Supports:
 * - Dotted hierarchies (e.g. 1.1.2.1 -> 1.1.2 -> 1.1 -> 1)
 * - 4-digit standard codes (e.g. 1111 -> 1110 -> 1100 -> 1000)
 * - Generalized prefix search for arbitrary code lengths
 */
export function inferParentCode(code: string, allCodes: Set<string>): string | null {
  const clean = code.trim();
  if (!clean) return null;

  // Dotted hierarchy: 1.1.2.1 -> 1.1.2 -> 1.1 -> 1
  if (clean.includes(".")) {
    const parts = clean.split(".");
    while (parts.length > 1) {
      parts.pop();
      const candidate = parts.join(".");
      if (allCodes.has(candidate)) return candidate;
    }
    return null;
  }

  // 4-digit standard general ledger numbering (e.g., 1000, 1100, 1110, 1111)
  if (/^\d{4}$/.test(clean)) {
    // 1000, 2000, 3000, 4000, 5000, 6000 are root level groups
    if (clean.endsWith("000")) return null;

    // 1100, 1200, 2100 -> parent is 1000, 2000
    if (clean.endsWith("00")) {
      const p = clean[0] + "000";
      return allCodes.has(p) ? p : null;
    }

    // 1110, 1120, 2110 -> parent is 1100, 2100
    if (clean.endsWith("0")) {
      const p1 = clean.slice(0, 2) + "00";
      if (allCodes.has(p1)) return p1;
      const p2 = clean[0] + "000";
      if (allCodes.has(p2)) return p2;
      return null;
    }

    // 1111, 1112 -> parent is 1110 -> 1100 -> 1000
    const p1 = clean.slice(0, 3) + "0";
    if (allCodes.has(p1)) return p1;
    const p2 = clean.slice(0, 2) + "00";
    if (allCodes.has(p2)) return p2;
    const p3 = clean[0] + "000";
    if (allCodes.has(p3)) return p3;
  }

  // Generalized prefix search for arbitrary codes (e.g. 5-digit: 11120 -> 11100 -> 11000)
  for (let len = clean.length - 1; len >= 1; len--) {
    const candidate = clean.slice(0, len);
    if (allCodes.has(candidate)) return candidate;
    const padded = candidate.padEnd(clean.length, "0");
    if (padded !== clean && allCodes.has(padded)) return padded;
  }

  return null;
}

/**
 * POST: Rebuild / re-link all Chart of Accounts hierarchy relationships
 * Analyzes all accounts currently in the database and automatically stages
 * parent-child links based on account code numbering and names.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await checkAuth(req, "accounts.write");
    const context = requestAuditContext(req);

    const accounts = await prisma.chartOfAccounts.findMany({
      select: { id: true, code: true, name: true, parentId: true },
      orderBy: { code: "asc" },
    });

    if (accounts.length === 0) {
      return NextResponse.json({ ok: false, error: "No accounts found in database" }, { status: 400 });
    }

    const codeToIdMap = new Map<string, string>();
    const allCodes = new Set<string>();

    accounts.forEach((acc) => {
      codeToIdMap.set(acc.code, acc.id);
      allCodes.add(acc.code);
    });

    const result = await prisma.$transaction(async (tx) => {
      let linkedCount = 0;
      let rootCount = 0;

      for (const acc of accounts) {
        const parentCode = inferParentCode(acc.code, allCodes);
        if (parentCode && codeToIdMap.has(parentCode)) {
          const parentId = codeToIdMap.get(parentCode)!;
          if (parentId !== acc.id) {
            await tx.chartOfAccounts.update({
              where: { id: acc.id },
              data: { parentId },
            });
            linkedCount++;
            continue;
          }
        }

        await tx.chartOfAccounts.update({
          where: { id: acc.id },
          data: { parentId: null },
        });
        rootCount++;
      }

      const audit = await appendAuditEvent({
        action: "COA_REBUILD_TREE",
        entityType: "ChartOfAccounts",
        entityCode: "COA_TREE",
        description: `Chart of Accounts hierarchy rebuilt by ${actor.email}`,
        changes: { totalAccounts: accounts.length, linkedCount, rootCount },
        actorEmail: actor.email,
        userId: actor.userId || null,
        outcome: "SUCCESS",
        ...context,
      }, tx);

      return { linkedCount, rootCount, auditId: audit.id };
    });

    return NextResponse.json({
      ok: true,
      message: `Successfully rebuilt hierarchy: ${result.linkedCount} accounts staged under parents, ${result.rootCount} root categories.`,
      totalAccounts: accounts.length,
      linkedCount: result.linkedCount,
      rootCount: result.rootCount,
      auditId: result.auditId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rebuild hierarchy";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}
