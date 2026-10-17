import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { standardCoaRows } from "@/lib/accounting/standard-coa";
import { prisma } from "@/src/lib/prisma";

export async function POST() {
  try {
    const actor = await requirePermission("accounts.write");
    const existingCount = await prisma.chartOfAccounts.count();
    if (existingCount > 0) {
      return NextResponse.json(
        { ok: false, error: "Standard COA can only be created when Chart of Accounts is empty. Delete full system master data first if you need a fresh standard COA." },
        { status: 409 },
      );
    }

    const settings = await prisma.globalSettings.findMany({
      where: { key: { in: ["company_short_name", "base_currency", "currency"] } },
      select: { key: true, value: true },
    });
    const valueOf = (key: string) => settings.find((row) => row.key === key)?.value || "";
    const companyShortName = valueOf("company_short_name") || "Easynet";
    const currency = valueOf("base_currency") || valueOf("currency") || "PGK";
    const rows = standardCoaRows(companyShortName, currency);

    // Validate the entire template before any database writes.
    const codes = new Set<string>();
    const byCode = new Map(rows.map((row) => [row.code, row]));
    for (const row of rows) {
      if (codes.has(row.code)) throw new Error(`Duplicate standard COA code: ${row.code}`);
      codes.add(row.code);
      if (row.parentCode && !byCode.has(row.parentCode)) throw new Error(`Missing parent account ${row.parentCode} for ${row.code}`);
      if (row.parentCode === row.code) throw new Error(`Account ${row.code} cannot parent itself`);
      const parent = row.parentCode ? byCode.get(row.parentCode) : null;
      if (parent && parent.type !== row.type && !(parent.type === "ASSET" && row.type === "CONTRA_ASSET") && !(parent.type === "LIABILITY" && row.type === "CONTRA_LIABILITY")) {
        throw new Error(`Account ${row.code} has incompatible parent type ${parent.type}`);
      }
      const visited = new Set([row.code]);
      let cursor = row.parentCode;
      while (cursor) {
        if (visited.has(cursor)) throw new Error(`Cycle in standard COA at ${row.code}`);
        visited.add(cursor);
        cursor = byCode.get(cursor)?.parentCode || "";
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (await tx.chartOfAccounts.count() > 0) throw new Error("Chart of Accounts is no longer empty; refresh and retry.");
      const codeToId = new Map<string, string>();
      let createdCount = 0;
      for (const row of rows) {
        const created = await tx.chartOfAccounts.create({
          data: {
            code: row.code,
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            currency,
            description: row.description,
            isActive: true,
            isSystem: false,
          },
          select: { id: true, code: true },
        });
        codeToId.set(created.code, created.id);
        createdCount++;
      }

      let parentLinksUpdated = 0;
      for (const row of rows) {
        if (!row.parentCode) continue;
        const accountId = codeToId.get(row.code);
        const parentId = codeToId.get(row.parentCode);
        if (!accountId || !parentId) throw new Error(`Standard COA parent ${row.parentCode} for ${row.code} could not be resolved`);
        await tx.chartOfAccounts.update({ where: { id: accountId }, data: { parentId } });
        parentLinksUpdated++;
      }

      const dbUser = await tx.user.findUnique({ where: { email: actor.email.toLowerCase() }, select: { id: true } });
      if (!dbUser) throw new Error("Authenticated user record not found for standard COA audit");
      const audit = await tx.auditLog.create({
        data: {
          action: "CREATE",
          entityType: "ChartOfAccounts",
          entityCode: "STANDARD_COA",
          description: `Standard Chart of Accounts created by ${actor.email}.`,
          changes: JSON.stringify({ createdCount, parentLinksUpdated, companyShortName, currency }),
          userId: dbUser.id,
        },
      });
      return { createdCount, parentLinksUpdated, auditId: audit.id };
    });

    return NextResponse.json({
      ok: true,
      message: `Standard Chart of Accounts created: ${result.createdCount} accounts and ${result.parentLinksUpdated} hierarchy links.`,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Standard Chart of Accounts could not be created";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}
