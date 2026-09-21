import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const CASH_BANK_IDS = new Set(["ACC-1110", "ACC-1120", "ACC-1121"]);

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    const [accounts, linkedBankAccounts, settings] = await Promise.all([
      prisma.chartOfAccounts.findMany({
        where: { isActive: true },
        include: {
          parent: { select: { code: true } },
          children: { select: { id: true } },
          journalLines: { where: { journal: { status: "POSTED" } }, select: { debit: true, credit: true } },
        },
        orderBy: { code: "asc" },
      }),
      prisma.bankAccount.findMany({
        where: { isActive: true, chartOfAccountsId: { not: null } },
        include: { chartOfAccounts: { select: { code: true } } },
      }).catch(() => []),
      prisma.globalSettings.findMany({
        where: { key: { in: ["default_cash_account", "default_bank_account", "currency", "base_currency"] } },
        select: { key: true, value: true },
      }).catch(() => []),
    ]);
    const dynamicCashBankIds = new Set(CASH_BANK_IDS);
    linkedBankAccounts.forEach((row) => {
      if (row.chartOfAccounts?.code) dynamicCashBankIds.add(`ACC-${row.chartOfAccounts.code}`);
    });
    settings.filter((row) => ["default_cash_account", "default_bank_account"].includes(row.key)).forEach((row) => {
      const code = String(row.value || "").trim().replace(/^ACC-/i, "");
      if (code) dynamicCashBankIds.add(`ACC-${code}`);
    });
    const baseCurrency = String(
      settings.find((row) => row.key === "currency")?.value
      || settings.find((row) => row.key === "base_currency")?.value
      || "PGK",
    ).trim().toUpperCase();

    const allAccounts = accounts
      .filter((row) => row.children.length === 0)
      .map((row) => {
        const postingId = `ACC-${row.code}`;
        const rawBalance = row.journalLines.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0);
        const creditNormal = ["LIABILITY", "EQUITY", "INCOME", "REVENUE"].includes(String(row.type).toUpperCase());
        return {
          accountId: postingId,
          accountCode: row.code,
          accountName: row.name,
          accountType: String(row.type),
          parentAccount: row.parent ? `ACC-${row.parent.code}` : "",
          balance: creditNormal ? -rawBalance : rawBalance,
          isCashBank: dynamicCashBankIds.has(postingId),
          accountRole: dynamicCashBankIds.has(postingId) ? "cash-bank" : "",
        };
      });

    const cashBankAccounts = allAccounts
      .filter((row) => row.isCashBank)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return NextResponse.json({ ok: true, accounts: allAccounts, cashBankAccounts, baseCurrency });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference option load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 500 },
    );
  }
}
