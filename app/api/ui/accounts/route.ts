import { NextRequest, NextResponse } from "next/server";
import { requireConfigurationPermission, requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";
import { AccountTypeGL, NormalBalance } from "@prisma/client";
import { isUnlinkedBankLedger } from "@/lib/accounting/bank-ledger-status";

export async function GET() {
  try {
    await requirePermission("accounts.read");
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      const accounts = await prisma.chartOfAccounts.findMany({
        include: {
          parent: { select: { id: true, code: true, name: true } },
          children: { select: { id: true } },
          journalLines: { where: { journal: { status: "POSTED" } }, select: { debit: true, credit: true } },
          bankAccounts: { where: { isActive: true }, select: { id: true } },
          _count: { select: { children: true, journalLines: true, bankAccounts: true } },
        },
        orderBy: { code: "asc" },
      });

      // 1. Direct balances
      const directMap = new Map<
        string,
        {
          directDebit: number;
          directCredit: number;
          directBalance: number;
          childIds: string[];
        }
      >();

      accounts.forEach((account) => {
        const directDebit = account.journalLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
        const directCredit = account.journalLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
        const isCreditNormal = account.normalBalance === NormalBalance.CREDIT;
        const directBalance = isCreditNormal ? directCredit - directDebit : directDebit - directCredit;

        directMap.set(account.id, {
          directDebit,
          directCredit,
          directBalance,
          childIds: account.children.map((c) => c.id),
        });
      });

      // 2. Recursive roll-up for parent/group accounts
      const memo = new Map<string, { balance: number; totalDebit: number; totalCredit: number }>();
      function getRollup(id: string): { balance: number; totalDebit: number; totalCredit: number } {
        if (memo.has(id)) return memo.get(id)!;
        const node = directMap.get(id);
        if (!node) return { balance: 0, totalDebit: 0, totalCredit: 0 };

        let balance = node.directBalance;
        let totalDebit = node.directDebit;
        let totalCredit = node.directCredit;

        for (const childId of node.childIds) {
          const childRollup = getRollup(childId);
          balance += childRollup.balance;
          totalDebit += childRollup.totalDebit;
          totalCredit += childRollup.totalCredit;
        }

        const res = { balance, totalDebit, totalCredit };
        memo.set(id, res);
        return res;
      }

      return NextResponse.json({
        ok: true,
        source: "prisma",
        accounts: accounts.map((account) => {
          const rollup = getRollup(account.id);
          const direct = directMap.get(account.id)!;
          return {
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            accountType: account.type,
            parentId: account.parentId,
            parentCode: account.parent?.code || null,
            parentName: account.parent?.name || null,
            parentAccount: account.parent ? `${account.parent.code} — ${account.parent.name}` : "",
            normalBalance: account.normalBalance,
            currency: account.currency || "PGK",
            description: account.description || "",
            taxCode: account.taxCode || "",
            active: account.isActive,
            isSystem: account.isSystem,
            childCount: account._count.children,
            journalLineCount: account._count.journalLines,
            bankLinkCount: account._count.bankAccounts,
            bankActiveLinkCount: account.bankAccounts.length,
            isUnlinkedBankLedger: isUnlinkedBankLedger(account.description, account.bankAccounts.length),
            isGroup: account._count.children > 0,
            directDebit: direct.directDebit,
            directCredit: direct.directCredit,
            directBalance: direct.directBalance,
            totalDebit: rollup.totalDebit,
            totalCredit: rollup.totalCredit,
            balance: rollup.balance,
          };
        }),
      });
    }

    const result = await listTable("Accounts", 500, 0);
    return NextResponse.json({ ok: true, accounts: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load accounts";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireConfigurationPermission("accounts.write");
    const body = await req.json();
    const { code, name, type, parentId, normalBalance, currency, description, taxCode, isActive } = body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ ok: false, error: "Account code is required" }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ ok: false, error: "Account name is required" }, { status: 400 });
    }
    if (!type || !Object.values(AccountTypeGL).includes(type as AccountTypeGL)) {
      return NextResponse.json({ ok: false, error: `Invalid account type: ${type}` }, { status: 400 });
    }

    const cleanCode = code.trim();
    const existing = await prisma.chartOfAccounts.findUnique({ where: { code: cleanCode } });
    if (existing) {
      return NextResponse.json({ ok: false, error: `Account code "${cleanCode}" already exists` }, { status: 400 });
    }

    let validParentId: string | null = null;
    if (parentId && typeof parentId === "string" && parentId.trim()) {
      const parent = await prisma.chartOfAccounts.findUnique({ where: { id: parentId.trim() } });
      if (!parent) {
        return NextResponse.json({ ok: false, error: "Selected parent account does not exist" }, { status: 400 });
      }
      validParentId = parent.id;
    }

    const newAccount = await prisma.chartOfAccounts.create({
      data: {
        code: cleanCode,
        name: name.trim(),
        type: type as AccountTypeGL,
        parentId: validParentId,
        normalBalance: normalBalance === NormalBalance.CREDIT ? NormalBalance.CREDIT : NormalBalance.DEBIT,
        currency: (currency || "PGK").trim().toUpperCase(),
        description: description ? String(description).trim() : null,
        taxCode: taxCode ? String(taxCode).trim() : null,
        isActive: isActive !== false,
      },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, journalLines: true, bankAccounts: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      account: {
        accountId: newAccount.id,
        accountCode: newAccount.code,
        accountName: newAccount.name,
        accountType: newAccount.type,
        parentId: newAccount.parentId,
        parentCode: newAccount.parent?.code || null,
        parentName: newAccount.parent?.name || null,
        parentAccount: newAccount.parent ? `${newAccount.parent.code} — ${newAccount.parent.name}` : "",
        normalBalance: newAccount.normalBalance,
        currency: newAccount.currency,
        description: newAccount.description || "",
        taxCode: newAccount.taxCode || "",
        active: newAccount.isActive,
        isSystem: newAccount.isSystem,
        childCount: newAccount._count.children,
        journalLineCount: newAccount._count.journalLines,
        bankLinkCount: newAccount._count.bankAccounts,
        bankActiveLinkCount: 0,
        isUnlinkedBankLedger: false,
        isGroup: false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create account";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireConfigurationPermission("accounts.write");
    const body = await req.json();
    const { accountId, code, name, type, parentId, normalBalance, currency, description, taxCode, isActive } = body;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: "Account ID is required" }, { status: 400 });
    }

    const current = await prisma.chartOfAccounts.findUnique({
      where: { id: accountId },
      include: {
        children: { select: { id: true } },
        bankAccounts: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });

    if (!current) {
      return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });
    }

    const updateData: {
      code?: string;
      name?: string;
      type?: AccountTypeGL;
      parentId?: string | null;
      normalBalance?: NormalBalance;
      currency?: string;
      description?: string | null;
      taxCode?: string | null;
      isActive?: boolean;
    } = {};

    if (code && typeof code === "string" && code.trim() !== current.code) {
      const cleanCode = code.trim();
      const codeTaken = await prisma.chartOfAccounts.findUnique({ where: { code: cleanCode } });
      if (codeTaken) {
        return NextResponse.json({ ok: false, error: `Account code "${cleanCode}" is already taken` }, { status: 400 });
      }
      updateData.code = cleanCode;
    }

    if (name && typeof name === "string") {
      updateData.name = name.trim();
    }

    if (type && Object.values(AccountTypeGL).includes(type as AccountTypeGL)) {
      updateData.type = type as AccountTypeGL;
    }

    if (normalBalance && (normalBalance === NormalBalance.DEBIT || normalBalance === NormalBalance.CREDIT)) {
      updateData.normalBalance = normalBalance;
    }

    if (currency && typeof currency === "string") {
      updateData.currency = currency.trim().toUpperCase();
    }

    if (description !== undefined) {
      updateData.description = description ? String(description).trim() : null;
    }

    if (taxCode !== undefined) {
      updateData.taxCode = taxCode ? String(taxCode).trim() : null;
    }

    if (typeof isActive === "boolean") {
      if (isActive === false && current.isActive && current.bankAccounts.length > 0) {
        const linkedBank = current.bankAccounts[0];
        return NextResponse.json(
          {
            ok: false,
            error: `Cannot deactivate account ${current.code}: it is linked to company bank account ${linkedBank.code} — ${linkedBank.name}. Re-link the bank account to another valid active bank ledger first.`,
          },
          { status: 400 }
        );
      }
      updateData.isActive = isActive;
    }

    if (parentId !== undefined) {
      if (!parentId || parentId === "" || parentId === "none" || parentId === "null") {
        updateData.parentId = null;
      } else if (parentId === accountId) {
        return NextResponse.json({ ok: false, error: "An account cannot be its own parent" }, { status: 400 });
      } else {
        // Prevent circular loops: check if parentId is in descendants of accountId
        const descendants = await getDescendantIds(accountId);
        if (descendants.has(parentId)) {
          return NextResponse.json(
            { ok: false, error: "Cannot set parent to a descendant child account (circular loop)" },
            { status: 400 }
          );
        }
        const parent = await prisma.chartOfAccounts.findUnique({ where: { id: parentId } });
        if (!parent) {
          return NextResponse.json({ ok: false, error: "Selected parent account does not exist" }, { status: 400 });
        }
        updateData.parentId = parent.id;
      }
    }

    const updated = await prisma.chartOfAccounts.update({
      where: { id: accountId },
      data: updateData,
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, journalLines: true, bankAccounts: true } },
        bankAccounts: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      account: {
        accountId: updated.id,
        accountCode: updated.code,
        accountName: updated.name,
        accountType: updated.type,
        parentId: updated.parentId,
        parentCode: updated.parent?.code || null,
        parentName: updated.parent?.name || null,
        parentAccount: updated.parent ? `${updated.parent.code} — ${updated.parent.name}` : "",
        normalBalance: updated.normalBalance,
        currency: updated.currency,
        description: updated.description || "",
        taxCode: updated.taxCode || "",
        active: updated.isActive,
        isSystem: updated.isSystem,
        childCount: updated._count.children,
        journalLineCount: updated._count.journalLines,
        bankLinkCount: updated._count.bankAccounts,
        bankActiveLinkCount: updated.bankAccounts.filter((row) => row.isActive).length,
        isUnlinkedBankLedger: isUnlinkedBankLedger(updated.description, updated.bankAccounts.filter((row) => row.isActive).length),
        isGroup: updated._count.children > 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update account";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireConfigurationPermission("accounts.write");
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    if (!accountId) {
      return NextResponse.json({ ok: false, error: "Account ID is required" }, { status: 400 });
    }

    const account = await prisma.chartOfAccounts.findUnique({
      where: { id: accountId },
      include: {
        bankAccounts: { select: { id: true, code: true, name: true, isActive: true } },
        _count: { select: { children: true, journalLines: true } },
      },
    });

    if (!account) {
      return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });
    }

    if (account.bankAccounts.length > 0) {
      const linkedBank = account.bankAccounts[0];
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot delete account ${account.code}: it is linked to company bank account ${linkedBank.code} — ${linkedBank.name}. Re-link the bank account to another valid active bank ledger first.`,
        },
        { status: 400 }
      );
    }

    if (account.isSystem) {
      return NextResponse.json(
        { ok: false, error: "System core account cannot be deleted. You may deactivate it instead." },
        { status: 400 }
      );
    }

    if (account._count.children > 0) {
      return NextResponse.json(
        { ok: false, error: `Cannot delete account: It has ${account._count.children} child accounts. Delete or re-parent children first.` },
        { status: 400 }
      );
    }

    if (account._count.journalLines > 0) {
      return NextResponse.json(
        { ok: false, error: `Cannot delete account: It has ${account._count.journalLines} posted journal transactions. Deactivate the account instead to maintain audit integrity.` },
        { status: 400 }
      );
    }

    await prisma.chartOfAccounts.delete({ where: { id: accountId } });

    return NextResponse.json({ ok: true, deletedAccountId: accountId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete account";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}

async function getDescendantIds(accountId: string): Promise<Set<string>> {
  const result = new Set<string>();
  const queue = [accountId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = await prisma.chartOfAccounts.findMany({
      where: { parentId: currentId },
      select: { id: true },
    });
    for (const child of children) {
      if (!result.has(child.id)) {
        result.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return result;
}
