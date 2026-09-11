import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { NormalBalance } from "@prisma/client";

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

    // Build date filter
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // Fetch journal lines
    const rawLines = await prisma.journalLine.findMany({
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
    });

    // Calculate running balance
    const isCreditNormal = account.normalBalance === NormalBalance.CREDIT;
    let runningBalance = 0;
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
        currency: account.currency || "PGK",
        normalBalance: account.normalBalance,
        isGroup: account._count.children > 0,
        childCount: account._count.children,
        parentAccount: account.parent ? `${account.parent.code} — ${account.parent.name}` : "",
      },
      summary: {
        totalDebit,
        totalCredit,
        netBalance: isCreditNormal ? totalCredit - totalDebit : totalDebit - totalCredit,
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
