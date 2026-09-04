import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

const schema = z.object({
  budgetId: z.string().trim().optional().default(""),
  financialYear: z.string().trim().min(4),
  period: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  budgetAmount: z.coerce.number().finite().nonnegative(),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

const n = (value: unknown) => Number(value || 0);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function GET() {
  try {
    const [budgets, accounts, headers, lines] = await Promise.all([
      listTable<any>("Budgets", 500, 0),
      listTable<any>("Accounts", 500, 0),
      listTable<any>("JournalHeaders", 500, 0),
      listTable<any>("JournalLines", 500, 0),
    ]);

    const accountType = new Map<string, string>(
      accounts.rows.map((row: any) => [String(row.accountId), String(row.accountType)] as [string, string]),
    );
    const postingDate = new Map<string, string>(
      headers.rows
        .filter((row: any) => row.status === "POSTED")
        .map((row: any) => [String(row.journalId), String(row.postingDate)] as [string, string]),
    );

    const calculated = budgets.rows.map((budget: any) => {
      const year = String(budget.financialYear);
      const period = String(budget.period || "ANNUAL").toUpperCase();
      let actual = 0;
      for (const line of lines.rows as any[]) {
        if (line.accountId !== budget.accountId) continue;
        if (budget.projectId && line.projectId !== budget.projectId) continue;
        const rawDate = postingDate.get(String(line.journalId));
        if (!rawDate) continue;
        let date = "";
        try { date = normalizeAccountingDate(rawDate); } catch { continue; }
        if (!date.startsWith(year)) continue;
        if (period !== "ANNUAL" && period !== year && !date.startsWith(period)) continue;
        const type = accountType.get(String(line.accountId));
        if (type === "Income" || type === "Liability" || type === "Equity") actual += n(line.credit) - n(line.debit);
        else actual += n(line.debit) - n(line.credit);
      }
      actual = round2(actual);
      const budgetAmount = n(budget.budgetAmount);
      return { ...budget, actualAmount: actual, variance: round2(budgetAmount - actual) };
    });

    return NextResponse.json({ ok: true, budgets: calculated, accounts: accounts.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Budget read failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; record?: unknown };
    requireSecret(body.secret);
    const record = schema.parse(body.record || {});

    const account = await findRecords("Accounts", { accountId: record.accountId }, 1);
    if (!account.rows.length) throw new Error("Budget account does not exist");
    if (record.projectId) {
      const project = await findRecords("Projects", { projectId: record.projectId }, 1);
      if (!project.rows.length) throw new Error("Budget project does not exist");
    }

    const budgetId = record.budgetId || `BUD-${record.financialYear}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const duplicate = await findRecords("Budgets", { budgetId }, 1);
    if (duplicate.rows.length) throw new Error(`Budget ID already exists: ${budgetId}`);

    const result = await appendRecord("Budgets", {
      ...record,
      budgetId,
      actualAmount: 0,
      variance: record.budgetAmount,
    }, "budget-ui");
    return NextResponse.json({ ok: true, row: result.row });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Budget write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
