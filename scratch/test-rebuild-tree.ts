import { prisma } from "../src/lib/prisma";

export function inferParentCode(code: string, allCodes: Set<string>): string | null {
  const clean = code.trim();
  if (clean.includes(".")) {
    const parts = clean.split(".");
    while (parts.length > 1) {
      parts.pop();
      const candidate = parts.join(".");
      if (allCodes.has(candidate)) return candidate;
    }
    return null;
  }

  if (/^\d{4}$/.test(clean)) {
    if (clean.endsWith("000")) return null;
    if (clean.endsWith("00")) {
      const p = clean[0] + "000";
      return allCodes.has(p) ? p : null;
    }
    if (clean.endsWith("0")) {
      const p1 = clean.slice(0, 2) + "00";
      if (allCodes.has(p1)) return p1;
      const p2 = clean[0] + "000";
      if (allCodes.has(p2)) return p2;
      return null;
    }
    const p1 = clean.slice(0, 3) + "0";
    if (allCodes.has(p1)) return p1;
    const p2 = clean.slice(0, 2) + "00";
    if (allCodes.has(p2)) return p2;
    const p3 = clean[0] + "000";
    if (allCodes.has(p3)) return p3;
  }

  for (let len = clean.length - 1; len >= 1; len--) {
    const candidate = clean.slice(0, len);
    if (allCodes.has(candidate)) return candidate;
    const padded = candidate.padEnd(clean.length, "0");
    if (padded !== clean && allCodes.has(padded)) return padded;
  }

  return null;
}

async function rebuildTree() {
  const accounts = await prisma.chartOfAccounts.findMany({
    select: { id: true, code: true, name: true, parentId: true },
    orderBy: { code: "asc" },
  });

  const codeToIdMap = new Map<string, string>();
  const allCodes = new Set<string>();

  accounts.forEach((acc) => {
    codeToIdMap.set(acc.code, acc.id);
    allCodes.add(acc.code);
  });

  let linked = 0;
  let roots = 0;

  for (const acc of accounts) {
    const parentCode = inferParentCode(acc.code, allCodes);
    if (parentCode && codeToIdMap.has(parentCode)) {
      const parentId = codeToIdMap.get(parentCode)!;
      await prisma.chartOfAccounts.update({
        where: { id: acc.id },
        data: { parentId },
      });
      linked++;
    } else {
      await prisma.chartOfAccounts.update({
        where: { id: acc.id },
        data: { parentId: null },
      });
      roots++;
    }
  }

  console.log(`Rebuild complete: ${linked} accounts linked to parents, ${roots} root accounts.`);
}

rebuildTree().catch(console.error);
