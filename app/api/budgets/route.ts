import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable, backendConfigStatus } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { prisma } from "@/src/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const schema = z.object({
  budgetId: z.string().trim().optional().default(""),
  financialYear: z.string().trim().regex(/^\d{4}$/, "Financial year must be YYYY"),
  period: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  projectId: z.string().trim().optional().default(""),
  budgetAmount: z.coerce.number().finite().nonnegative(),
});

function requireSecret(secret?: string) {
  const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
  if (!env.APP_SECRET && !backendConfigured) return;
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

const n = (value: unknown) => Number(value || 0);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function GET() {
  try {
    await requirePermission("accounts.read");
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      const [budgets, accounts, headers, lines] = await Promise.all([
        prisma.budget.findMany({ orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }] }),
        prisma.chartOfAccounts.findMany({ orderBy: { code: "asc" } }),
        prisma.journalHeader.findMany({ where: { status: "POSTED" } }),
        prisma.journalLine.findMany({ include: { journal: true } }),
      ]);
      const postingDate = new Map(headers.map((row) => [row.id, row.date]));
      const calculated = budgets.map((budget) => {
        const period = budget.periodValue || budget.period.toUpperCase();
        const actual = lines
          .filter((line) => line.accountId === budget.accountId && (!budget.projectId || line.projectId === budget.projectId))
          .filter((line) => {
            const date = postingDate.get(line.journalId);
            if (!date || date.getUTCFullYear() !== budget.fiscalYear) return false;
            return period === "ANNUAL" || period === "YEARLY" || period === `${budget.fiscalYear}` || date.toISOString().startsWith(period);
          })
          .reduce((sum, line) => {
            const type = accounts.find((account) => account.id === line.accountId)?.type;
            return sum + (["Income", "Liability", "Equity"].includes(type || "") ? Number(line.credit) - Number(line.debit) : Number(line.debit) - Number(line.credit));
          }, 0);
        const budgetAmount = Number(budget.budgetAmount);
        return {
          budgetId: budget.code,
          financialYear: String(budget.fiscalYear),
          period,
          accountId: budget.accountId || "",
          projectId: budget.projectId || "",
          budgetAmount,
          actualAmount: round2(actual),
          variance: round2(budgetAmount - actual),
        };
      });
      return NextResponse.json({
        ok: true,
        source: "prisma",
        budgets: calculated,
        accounts: accounts.map((row) => ({ accountId: row.id, accountCode: row.code, accountName: row.name })),
      });
    }
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
    const message = error instanceof Error ? error.message : "Budget read failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; record?: unknown };
    requireSecret(body.secret);
    const record = schema.parse(body.record || {});

    const normalizedPeriod = record.period.toUpperCase();
    if (normalizedPeriod !== "ANNUAL" && !/^\d{4}-\d{2}$/.test(normalizedPeriod)) {
      throw new Error("Budget period must be ANNUAL or YYYY-MM");
    }
    if (normalizedPeriod !== "ANNUAL" && !normalizedPeriod.startsWith(`${record.financialYear}-`)) {
      throw new Error("Budget period must fall within the selected financial year");
    }
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      const account = await prisma.chartOfAccounts.findUnique({ where: { id: record.accountId } });
      if (!account) throw new Error("Budget account does not exist");
      if (record.projectId) {
        const project = await prisma.project.findUnique({ where: { id: record.projectId } });
        if (!project) throw new Error("Budget project does not exist");
      }
      const duplicate = await prisma.budget.findFirst({
        where: {
          fiscalYear: Number(record.financialYear),
          periodValue: normalizedPeriod,
          accountId: record.accountId,
          projectId: record.projectId || null,
        },
      });
      if (duplicate) throw new Error(`A budget already exists for ${record.financialYear} ${normalizedPeriod}, account ${record.accountId}${record.projectId ? `, project ${record.projectId}` : ""}`);
      const budgetId = record.budgetId || documentSeriesId("Budget");
      const existingCode = await prisma.budget.findUnique({ where: { code: budgetId } });
      if (existingCode) throw new Error(`Budget ID already exists: ${budgetId}`);
      const budget = await prisma.budget.create({
        data: {
          code: budgetId,
          fiscalYear: Number(record.financialYear),
          period: normalizedPeriod === "ANNUAL" ? "YEARLY" : "MONTHLY",
          periodValue: normalizedPeriod,
          accountId: record.accountId,
          projectId: record.projectId || null,
          budgetAmount: record.budgetAmount,
          actualAmount: 0,
          variance: record.budgetAmount,
          createdBy: "budget-ui",
        },
      });
      return NextResponse.json({ ok: true, source: "prisma", row: { budgetId: budget.code } });
    }

    const account = await findRecords("Accounts", { accountId: record.accountId }, 1);
    if (!account.rows.length) throw new Error("Budget account does not exist");
    if (record.projectId) {
      const project = await findRecords("Projects", { projectId: record.projectId }, 1);
      if (!project.rows.length) throw new Error("Budget project does not exist");
    }

    const sameYear = await findRecords<any>("Budgets", { financialYear: record.financialYear }, 500);
    const semanticDuplicate = sameYear.rows.find((row) =>
      String(row.period || "").toUpperCase() === normalizedPeriod &&
      String(row.accountId || "") === record.accountId &&
      String(row.projectId || "") === record.projectId,
    );
    if (semanticDuplicate) throw new Error(`A budget already exists for ${record.financialYear} ${normalizedPeriod}, account ${record.accountId}${record.projectId ? `, project ${record.projectId}` : ""}`);

    const budgetId = record.budgetId || documentSeriesId("Budget");
    const duplicate = await findRecords("Budgets", { budgetId }, 1);
    if (duplicate.rows.length) throw new Error(`Budget ID already exists: ${budgetId}`);

    const result = await appendRecord("Budgets", {
      ...record,
      period: normalizedPeriod,
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
