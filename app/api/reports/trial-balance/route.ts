import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

function dateAtStart(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateAtEnd(value: string) {
  const date = dateAtStart(value);
  if (date) date.setHours(23, 59, 59, 999);
  return date;
}

/** A posted-ledger trial balance; only real persisted journals are included. */
export async function GET(request: NextRequest) {
  try {
    await requirePermission("reports.read");
    const { searchParams } = new URL(request.url);
    const asOf = dateAtEnd(searchParams.get("asOf") || new Date().toISOString().slice(0, 10));
    const startDate = searchParams.get("startDate") ? dateAtStart(searchParams.get("startDate")!) : null;
    if (!asOf) return NextResponse.json({ ok: false, error: "Invalid asOf date" }, { status: 400 });
    if (startDate && startDate > asOf) return NextResponse.json({ ok: false, error: "startDate must be on or before asOf" }, { status: 400 });

    const lines = await prisma.journalLine.findMany({
      where: {
        journal: {
          status: "POSTED",
          date: { ...(startDate ? { gte: startDate } : {}), lte: asOf },
        },
      },
      include: { account: true },
      orderBy: { account: { code: "asc" } },
    });

    const balances = new Map<string, { accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>();
    for (const line of lines) {
      const key = line.accountId;
      const current = balances.get(key) || {
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        debit: 0,
        credit: 0,
      };
      current.debit += Number(line.debit || 0);
      current.credit += Number(line.credit || 0);
      balances.set(key, current);
    }

    const accounts = [...balances.values()].map((row) => ({
      ...row,
      debit: Math.round(row.debit * 100) / 100,
      credit: Math.round(row.credit * 100) / 100,
    }));
    const totalDebit = Math.round(accounts.reduce((sum, row) => sum + row.debit, 0) * 100) / 100;
    const totalCredit = Math.round(accounts.reduce((sum, row) => sum + row.credit, 0) * 100) / 100;

    return NextResponse.json({
      ok: true,
      currency: "PGK",
      period: { startDate: startDate?.toISOString().slice(0, 10) || null, asOf: asOf.toISOString().slice(0, 10) },
      accounts,
      totals: { debit: totalDebit, credit: totalCredit, balanced: totalDebit === totalCredit },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build trial balance";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
