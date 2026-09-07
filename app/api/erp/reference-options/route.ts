import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";

const CASH_BANK_IDS = new Set(["ACC-1110", "ACC-1120", "ACC-1121"]);

function active(value: unknown) {
  return !["false", "0", "no", "inactive"].includes(String(value ?? "true").trim().toLowerCase());
}

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    const [accounts, lines] = await Promise.all([
      listTable<any>("Accounts", 500, 0),
      listTable<any>("JournalLines", 500, 0),
    ]);

    const balanceByAccount = new Map<string, number>();
    for (const line of lines.rows || []) {
      const id = String(line.accountId || "");
      if (!id) continue;
      const next = (balanceByAccount.get(id) || 0) + Number(line.debit || 0) - Number(line.credit || 0);
      balanceByAccount.set(id, Math.round((next + Number.EPSILON) * 100) / 100);
    }

    const allAccounts = (accounts.rows || [])
      .filter((row: any) => active(row.active))
      .map((row: any) => ({
        accountId: String(row.accountId || ""),
        accountCode: String(row.accountCode || ""),
        accountName: String(row.accountName || row.accountId || ""),
        accountType: String(row.accountType || ""),
        parentAccount: String(row.parentAccount || ""),
        balance: Number(balanceByAccount.get(String(row.accountId || "")) || 0),
      }));

    const cashBankAccounts = allAccounts
      .filter((row) => CASH_BANK_IDS.has(row.accountId))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return NextResponse.json({ ok: true, accounts: allAccounts, cashBankAccounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference option load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 500 },
    );
  }
}
