import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { NormalBalance } from "@prisma/client";

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([12]\d|3[01]|0[1-9])$/;

function pngAccountingDate(value: string, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+10:00`);
  const normalized = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "Pacific/Port_Moresby",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
  return normalized === value ? date : null;
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("accounts.read");
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");
    const accountCode = searchParams.get("accountCode");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const search = searchParams.get("search")?.toLowerCase().trim();

    if (!accountId && !accountCode) {
      return NextResponse.json({ ok: false, error: "accountId or accountCode is required" }, { status: 400 });
    }

    const account = await prisma.chartOfAccounts.findFirst({
      where: accountId ? { id: accountId } : { code: accountCode! },
      include: {
        parent: { select: { code: true, name: true } },
        _count: { select: { children: true } },
      },
    });

    if (!account) {
      return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });
    }

    // If group account, collect all descendant child IDs
    const targetAccountIds = [account.id];
    if (account._count.children > 0) {
      const descendants = await getAllDescendantIds(account.id);
      targetAccountIds.push(...descendants);
    }

    // Build strict PNG accounting-date filters.
    const parsedStart = startDate ? pngAccountingDate(startDate) : null;
    const parsedEnd = endDate ? pngAccountingDate(endDate, true) : null;
    if (startDate && !parsedStart) {
      return NextResponse.json({ ok: false, error: "Invalid startDate" }, { status: 400 });
    }
    if (endDate && !parsedEnd) {
      return NextResponse.json({ ok: false, error: "Invalid endDate" }, { status: 400 });
    }
    if (parsedStart && parsedEnd && parsedStart > parsedEnd) {
      return NextResponse.json({ ok: false, error: "startDate must be on or before endDate" }, { status: 400 });
    }

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (parsedStart) dateFilter.gte = parsedStart;
    if (parsedEnd) dateFilter.lte = parsedEnd;

    const [rawLines, openingLines, currencySettings] = await Promise.all([
      prisma.journalLine.findMany({
      where: {
        accountId: { in: targetAccountIds },
        journal: {
          status: "POSTED",
          ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        },
      },
      include: {
        journal: true,
        account: { select: { code: true, name: true } },
      },
        orderBy: [
          { journal: { date: "asc" } },
          { journal: { createdAt: "asc" } },
          { lineNo: "asc" },
        ],
      }),
      parsedStart
        ? prisma.journalLine.findMany({
            where: {
              accountId: { in: targetAccountIds },
              journal: { status: "POSTED", date: { lt: parsedStart } },
            },
            select: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      prisma.globalSettings.findMany({
        where: { key: { in: ["currency", "base_currency"] } },
        select: { key: true, value: true },
      }),
    ]);

    const baseCurrency = String(
      currencySettings.find((row) => row.key === "currency")?.value
      || currencySettings.find((row) => row.key === "base_currency")?.value
      || "PGK",
    ).trim().toUpperCase() || "PGK";

    // Calculate opening and running balance in company base currency.
    const isCreditNormal = account.normalBalance === NormalBalance.CREDIT;
    const openingDebit = openingLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const openingCredit = openingLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    const openingBalance = isCreditNormal
      ? openingCredit - openingDebit
      : openingDebit - openingCredit;
    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const entries = rawLines.map((line) => {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      totalDebit += debit;
      totalCredit += credit;

      if (isCreditNormal) {
        runningBalance += credit - debit;
      } else {
        runningBalance += debit - credit;
      }

      return {
        lineId: line.id,
        postingDate: line.journal.date.toISOString(),
        voucherNo: line.journal.code,
        voucherType: line.journal.sourceDocType || "JOURNAL",
        reference: line.journal.reference || "—",
        accountCode: line.account.code,
        accountName: line.account.name,
        description: line.description || line.journal.description,
        debit,
        credit,
        transactionCurrency: line.transactionCurrency || line.currency || baseCurrency,
        transactionDebit: Number(line.transactionDebit || 0),
        transactionCredit: Number(line.transactionCredit || 0),
        exchangeRate: Number(line.exchangeRate || 1),
        runningBalance,
      };
    });

    // Apply optional search filter on entries
    const filteredEntries = search
      ? entries.filter(
          (e) =>
            e.voucherNo.toLowerCase().includes(search) ||
            e.voucherType.toLowerCase().includes(search) ||
            e.reference.toLowerCase().includes(search) ||
            e.description.toLowerCase().includes(search) ||
            e.accountCode.toLowerCase().includes(search) ||
            e.accountName.toLowerCase().includes(search)
        )
      : entries;

    return NextResponse.json({
      ok: true,
      account: {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        currency: baseCurrency,
        accountCurrency: account.currency || baseCurrency,
        normalBalance: account.normalBalance,
        isGroup: account._count.children > 0,
        childCount: account._count.children,
        parentAccount: account.parent ? `${account.parent.code} — ${account.parent.name}` : "",
      },
      summary: {
        openingBalance,
        totalDebit,
        totalCredit,
        periodMovement: isCreditNormal ? totalCredit - totalDebit : totalDebit - totalCredit,
        netBalance: runningBalance,
        entryCount: entries.length,
      },
      entries: filteredEntries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load account ledger";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}

async function getAllDescendantIds(parentId: string): Promise<string[]> {
  const result: string[] = [];
  const queue = [parentId];

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const children = await prisma.chartOfAccounts.findMany({
      where: { parentId: currId },
      select: { id: true },
    });
    for (const c of children) {
      result.push(c.id);
      queue.push(c.id);
    }
  }

  return result;
}
