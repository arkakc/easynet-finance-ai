import { NextResponse } from "next/server";
import { listTable } from "@/lib/backend/apps-script";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import {
  expensePosting,
  receiptPosting,
  salesInvoicePostingByLines,
  supplierBillPostingByLines,
  supplierPaymentPosting,
  validateBalancedPosting,
  type PostingLine,
} from "@/lib/accounting/posting";
import { calculateCompoundMonthlyLoan } from "@/lib/accounting/loan";

function totals(lines: PostingLine[]) {
  return lines.reduce(
    (sum, line) => ({
      debit: Math.round((sum.debit + Number(line.debit || 0) + Number.EPSILON) * 100) / 100,
      credit: Math.round((sum.credit + Number(line.credit || 0) + Number.EPSILON) * 100) / 100,
    }),
    { debit: 0, credit: 0 },
  );
}

export async function GET() {
  try {
    const accountResult = await listTable<{
      accountId: string;
      accountName: string;
      parentAccount: string;
      active: boolean | string;
    }>("Accounts", 500, 0);
    const accounts = accountResult.rows;
    const accountIds = new Set(accounts.map((row) => String(row.accountId)));
    const parentIds = new Set(accounts.map((row) => String(row.parentAccount || "")).filter(Boolean));

    const cases: Array<{ name: string; lines: PostingLine[]; expectedDebit: number }> = [
      {
        name: "sales-invoice",
        lines: salesInvoicePostingByLines({
          total: 3300,
          gst: 300,
          customerId: "SELFTEST-CUSTOMER",
          projectId: "SELFTEST-PROJECT",
          revenueLines: [
            { accountId: "ACC-4100", amount: 1000 },
            { accountId: "ACC-4200", amount: 2000 },
          ],
        }),
        expectedDebit: 3300,
      },
      {
        name: "customer-receipt",
        lines: receiptPosting({
          amount: 3300,
          customerId: "SELFTEST-CUSTOMER",
          projectId: "SELFTEST-PROJECT",
          cashBankAccountId: INITIAL_ACCOUNT_IDS.bank,
        }),
        expectedDebit: 3300,
      },
      {
        name: "supplier-invoice",
        lines: supplierBillPostingByLines({
          total: 1650,
          gst: 150,
          supplierId: "SELFTEST-SUPPLIER",
          projectId: "SELFTEST-PROJECT",
          costLines: [{ accountId: "ACC-5100", amount: 1500 }],
        }),
        expectedDebit: 1650,
      },
      {
        name: "supplier-payment",
        lines: supplierPaymentPosting({
          amount: 1650,
          supplierId: "SELFTEST-SUPPLIER",
          projectId: "SELFTEST-PROJECT",
          cashBankAccountId: INITIAL_ACCOUNT_IDS.bank,
        }),
        expectedDebit: 1650,
      },
      {
        name: "cash-expense",
        lines: expensePosting({
          total: 110,
          net: 100,
          gst: 10,
          supplierId: "SELFTEST-SUPPLIER",
          projectId: "SELFTEST-PROJECT",
          expenseAccountId: "ACC-6600",
          cashBankAccountId: INITIAL_ACCOUNT_IDS.bank,
        }),
        expectedDebit: 110,
      },
    ];

    const checks = cases.map((testCase) => {
      validateBalancedPosting(testCase.lines);
      const sum = totals(testCase.lines);
      const missingAccounts = testCase.lines
        .map((line) => line.accountId)
        .filter((id) => !accountIds.has(id));
      const parentPostings = testCase.lines
        .map((line) => line.accountId)
        .filter((id) => parentIds.has(id));
      const ok =
        sum.debit === testCase.expectedDebit &&
        sum.credit === testCase.expectedDebit &&
        missingAccounts.length === 0 &&
        parentPostings.length === 0;
      return {
        name: testCase.name,
        ok,
        debit: sum.debit,
        credit: sum.credit,
        missingAccounts,
        parentPostings,
        lines: testCase.lines,
      };
    });

    const criticalIds = Object.values(INITIAL_ACCOUNT_IDS);
    const missingCriticalIds = criticalIds.filter((id) => !accountIds.has(id));
    const criticalParentIds = criticalIds.filter((id) => parentIds.has(id));
    const loan = calculateCompoundMonthlyLoan({
      principal: 1000,
      monthlyRate: 0.01,
      loanDate: "2026-01-01",
      asOf: "2026-04-01",
    });

    const ok =
      accounts.length === 72 &&
      missingCriticalIds.length === 0 &&
      criticalParentIds.length === 0 &&
      checks.every((check) => check.ok) &&
      loan.completedMonths === 3 &&
      Math.abs(loan.accruedInterest - 30.301) < 0.001;

    return NextResponse.json({
      ok,
      accountCount: accounts.length,
      missingCriticalIds,
      criticalParentIds,
      checks,
      loanCheck: {
        ok: loan.completedMonths === 3 && Math.abs(loan.accruedInterest - 30.301) < 0.001,
        completedMonths: loan.completedMonths,
        accruedInterest: loan.accruedInterest,
      },
    }, { status: ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Accounting self-test failed" },
      { status: 500 },
    );
  }
}
