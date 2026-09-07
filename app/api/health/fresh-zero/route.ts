import { NextResponse } from "next/server";
import { listReportingTable, listTable } from "@/lib/backend/apps-script";

const CORE_OPERATIONAL_TABLES = [
  "Customers", "Suppliers", "Projects", "Items",
  "Quotes", "QuoteLines", "PurchaseOrders", "POLines",
  "Invoices", "InvoiceLines", "SupplierBills", "SupplierBillLines",
  "Payments", "Expenses", "Loans", "LoanEvents",
  "JournalHeaders", "JournalLines", "PaymentSchedules", "StockMovements",
  "FixedAssets", "Budgets", "Exceptions", "AuditLog",
] as const;

const DOCUMENT_TABLES = ["Documents", "DocumentLines"] as const;
const REPORTING_TABLES = [
  "ReportDashboardKPI", "ReportDailySales", "ReportDailyPurchases",
  "ReportARSummary", "ReportAPSummary", "ReportGSTSummary",
  "ReportProjectProfitability",
] as const;

async function countCore(table: string) {
  return (await listTable<Record<string, unknown>>(table, 500, 0)).rows.length;
}

async function countReporting(table: string) {
  return (await listReportingTable<Record<string, unknown>>(table, 500, 0)).rows.length;
}

export async function GET() {
  try {
    const coreEntries = await Promise.all(
      CORE_OPERATIONAL_TABLES.map(async (table) => [table, await countCore(table)] as const),
    );
    const documentEntries = await Promise.all(
      DOCUMENT_TABLES.map(async (table) => [table, await countCore(table)] as const),
    );
    const reportingEntries = await Promise.all(
      REPORTING_TABLES.map(async (table) => [table, await countReporting(table)] as const),
    );
    const [accounts, settings] = await Promise.all([countCore("Accounts"), countCore("Settings")]);

    const core = Object.fromEntries(coreEntries);
    const document = Object.fromEntries(documentEntries);
    const reporting = Object.fromEntries(reportingEntries);
    const coreNonZero = coreEntries.filter(([, count]) => count > 0).map(([table]) => table);
    const documentNonZero = documentEntries.filter(([, count]) => count > 0).map(([table]) => table);

    return NextResponse.json({
      ok: true,
      freshZero: coreNonZero.length === 0 && documentNonZero.length === 0 && accounts > 0 && settings > 0,
      coreOperationalZero: coreNonZero.length === 0,
      documentZero: documentNonZero.length === 0,
      preservedConfiguration: { Accounts: accounts, Settings: settings },
      core,
      document,
      reporting,
      coreNonZeroTables: coreNonZero,
      documentNonZeroTables: documentNonZero,
      note: "Reporting tables are derived and may contain zero-value KPI rows after the automatic materializer runs; they are not user-entered data.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Fresh-zero verification failed",
    }, { status: 500 });
  }
}
