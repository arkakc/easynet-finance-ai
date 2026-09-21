import { NextResponse } from "next/server";
import { listTable } from "@/lib/backend/apps-script";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import {
  expensePosting,
  purchaseReceiptPosting,
  receiptPosting,
  salesInvoicePostingByLines,
  supplierBillPostingMixed,
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
    await ensureAccountingInfrastructure();
    const accountResult = await listTable<{
      accountId: string;
      accountName: string;
      parentAccount: string;
      active: boolean | string;
    }>("Accounts", 500, 0);
    const accounts = accountResult.rows;
    const accountIds = new Set(accounts.map((row) => String(row.accountId)));
    const parentIds = new Set(accounts.map((row) => String(row.parentAccount || "")).filter(Boolean));

    const mixedSupplier = supplierBillPostingMixed({
      total: 1760,
      gst: 160,
      supplierId: "SELFTEST-SUPPLIER",
      projectId: "SELFTEST-PROJECT",
      serviceCostLines: [{ accountId: "ACC-5200", amount: 500 }],
      stockLines: [{ invoiceAmount: 1100, poAmount: 1100, receiptValue: 1000 }],
    });

    const cases: Array<{ name: string; lines: PostingLine[]; expectedDebit: number }> = [
      {
        name: "stock-sales-invoice-with-cogs",
        lines: salesInvoicePostingByLines({
          total: 3300,
          gst: 300,
          customerId: "SELFTEST-CUSTOMER",
          projectId: "SELFTEST-PROJECT",
          revenueLines: [
            { accountId: "ACC-4100", amount: 1000 },
            { accountId: "ACC-4200", amount: 2000 },
          ],
          cogsLines: [{ accountId: "ACC-5100", amount: 900 }],
        }),
        expectedDebit: 4200,
      },
      {
        name: "customer-receipt",
        lines: receiptPosting({ amount: 3300, customerId: "SELFTEST-CUSTOMER", projectId: "SELFTEST-PROJECT", cashBankAccountId: INITIAL_ACCOUNT_IDS.bank }),
        expectedDebit: 3300,
      },
      {
        name: "customer-advance",
        lines: receiptPosting({ amount: 500, customerId: "SELFTEST-CUSTOMER", projectId: "SELFTEST-PROJECT", cashBankAccountId: INITIAL_ACCOUNT_IDS.bank, advance: true }),
        expectedDebit: 500,
      },
      {
        name: "supplier-advance",
        lines: supplierPaymentPosting({ amount: 400, supplierId: "SELFTEST-SUPPLIER", projectId: "SELFTEST-PROJECT", cashBankAccountId: INITIAL_ACCOUNT_IDS.bank, advance: true }),
        expectedDebit: 400,
      },
      {
        name: "purchase-receipt-grni",
        lines: purchaseReceiptPosting({ inventoryValue: 1000, supplierId: "SELFTEST-SUPPLIER", projectId: "SELFTEST-PROJECT" }),
        expectedDebit: 1000,
      },
      {
        name: "mixed-supplier-invoice-grni-ppv",
        lines: mixedSupplier.lines,
        expectedDebit: 1760,
      },
      {
        name: "supplier-payment",
        lines: supplierPaymentPosting({ amount: 1760, supplierId: "SELFTEST-SUPPLIER", projectId: "SELFTEST-PROJECT", cashBankAccountId: INITIAL_ACCOUNT_IDS.bank }),
        expectedDebit: 1760,
      },
      {
        name: "cash-expense",
        lines: expensePosting({ total: 110, net: 100, gst: 10, supplierId: "SELFTEST-SUPPLIER", projectId: "SELFTEST-PROJECT", expenseAccountId: "ACC-6600", cashBankAccountId: INITIAL_ACCOUNT_IDS.bank }),
        expectedDebit: 110,
      },
    ];

    const checks = cases.map((testCase) => {
      validateBalancedPosting(testCase.lines);
      const sum = totals(testCase.lines);
      const missingAccounts = testCase.lines.map((line) => line.accountId).filter((id) => !accountIds.has(id));
      const parentPostings = testCase.lines.map((line) => line.accountId).filter((id) => parentIds.has(id));
      const ok = sum.debit === testCase.expectedDebit && sum.credit === testCase.expectedDebit && missingAccounts.length === 0 && parentPostings.length === 0;
      return { name: testCase.name, ok, debit: sum.debit, credit: sum.credit, missingAccounts, parentPostings, lines: testCase.lines };
    });

    const criticalIds = Object.values(INITIAL_ACCOUNT_IDS);
    const missingCriticalIds = criticalIds.filter((id) => !accountIds.has(id));
    const criticalParentIds = criticalIds.filter((id) => parentIds.has(id));
    const loan = calculateCompoundMonthlyLoan({ principal: 1000, monthlyRate: 0.01, loanDate: "2026-01-01", asOf: "2026-04-01" });

    const ok = accounts.length >= 77
      && missingCriticalIds.length === 0
      && criticalParentIds.length === 0
      && checks.every((check) => check.ok)
      && loan.completedMonths === 3
      && Math.abs(loan.accruedInterest - 30.301) < 0.001
      && mixedSupplier.purchasePriceVariance === 100;

    return NextResponse.json({
      ok,
      accountCount: accounts.length,
      expectedMinimumAccountCount: 77,
      missingCriticalIds,
      criticalParentIds,
      checks,
      purchasePriceVarianceCheck: { ok: mixedSupplier.purchasePriceVariance === 100, value: mixedSupplier.purchasePriceVariance },
      loanCheck: { ok: loan.completedMonths === 3 && Math.abs(loan.accruedInterest - 30.301) < 0.001, completedMonths: loan.completedMonths, accruedInterest: loan.accruedInterest },
    }, { status: ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Accounting self-test failed" }, { status: 500 });
  }
}
