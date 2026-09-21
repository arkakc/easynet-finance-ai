import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { companyBaseCurrency } from "@/lib/accounting/currency";
import { prisma } from "@/src/lib/prisma";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function accountingDate(value: string, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+10:00`);
  if (Number.isNaN(date.getTime())) return null;
  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return normalized === value ? date : null;
}

/** A posted-ledger trial balance; only real persisted journals are included. */
export async function GET(request: NextRequest) {
  try {
    await requirePermission("reports.read");
    const { searchParams } = new URL(request.url);
    const asOfText = searchParams.get("asOf") || new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Port_Moresby",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const asOf = accountingDate(asOfText, true);
    const startDateText = searchParams.get("startDate");
    const startDate = startDateText ? accountingDate(startDateText) : null;
    if (!asOf) return NextResponse.json({ ok: false, error: "Invalid asOf date" }, { status: 400 });
    if (startDateText && !startDate) return NextResponse.json({ ok: false, error: "Invalid startDate" }, { status: 400 });
    if (startDate && startDate > asOf) return NextResponse.json({ ok: false, error: "startDate must be on or before asOf" }, { status: 400 });

    const [lines, baseCurrency] = await Promise.all([
      prisma.journalLine.findMany({
      where: {
        journal: {
          status: "POSTED",
          date: { ...(startDate ? { gte: startDate } : {}), lte: asOf },
        },
      },
      include: { account: true },
        orderBy: { account: { code: "asc" } },
      }),
      prisma.$transaction((tx) => companyBaseCurrency(tx)),
    ]);

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
      currency: baseCurrency,
      period: { startDate: startDateText || null, asOf: asOfText },
      accounts,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        difference: Math.round((totalDebit - totalCredit) * 100) / 100,
        balanced: Math.abs(totalDebit - totalCredit) < 0.01,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build trial balance";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
