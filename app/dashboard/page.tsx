import Link from "next/link";
import { listReportingTable } from "@/lib/backend/apps-script";
import { completedMonthlyPeriods, monthlyAnniversaryDate, normalizeAccountingDate } from "@/lib/accounting/loan";

export const dynamic = "force-dynamic";

type DashboardKPI = { key: string; value: string | number; updatedAt: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);

export default async function DashboardPage() {
  let backendError = "";
  let rows: DashboardKPI[] = [];

  try {
    const result = await listReportingTable<DashboardKPI>("ReportDashboardKPI", 100, 0);
    rows = result.rows;
    if (!rows.length) backendError = "Reporting summary is empty. Refresh the Reporting database materializer.";
  } catch (error) {
    backendError = error instanceof Error ? error.message : "Reporting backend read failed";
  }

  const values = new Map(rows.map((row) => [row.key, row.value]));
  const get = (key: string, fallback: string | number = "") => values.get(key) ?? fallback;

  const cashBank = n(get("cashBank"));
  const accountsReceivable = n(get("accountsReceivable"));
  const accountsPayable = n(get("accountsPayable"));
  const gstPayable = n(get("gstPayable"));
  const revenue = n(get("revenuePosted"));
  const expenses = n(get("expensesPosted"));
  const netProfit = n(get("netProfitPosted"));
  const poCommitments = n(get("poCommitments"));
  const gstStatus = String(get("gstStatus", "UNVERIFIED"));
  const draftApprovals = n(get("draftApprovals"));
  const activeProjects = n(get("activeProjects"));
  const sourcePending = n(get("sourcePending"));
  const arSubledger = n(get("arSubledger"));
  const apSubledger = n(get("apSubledger"));

  const activeLoan = String(get("loanStatus")).toUpperCase() === "ACTIVE";
  let nextLoanAccrual = "";
  if (activeLoan) {
    try {
      const loanDate = normalizeAccountingDate(String(get("loanDate")));
      const lastAccrued = normalizeAccountingDate(String(get("loanLastAccruedThrough", loanDate)));
      const recognizedPeriods = completedMonthlyPeriods(loanDate, lastAccrued);
      nextLoanAccrual = monthlyAnniversaryDate(loanDate, recognizedPeriods + 1);
    } catch {
      nextLoanAccrual = String(get("loanFirstAccrualDate", "Review required"));
    }
  }

  const unavailable = "Unavailable";
  const kpis = [
    ["Cash & Bank", backendError ? unavailable : money(cashBank)],
    ["Accounts Receivable", backendError ? unavailable : money(accountsReceivable)],
    ["Accounts Payable", backendError ? unavailable : money(accountsPayable)],
    ["GST Payable", backendError ? unavailable : money(gstPayable)],
    ["Revenue (Posted)", backendError ? unavailable : money(revenue)],
    ["Expenses (Posted)", backendError ? unavailable : money(expenses)],
    ["Net Profit (Posted)", backendError ? unavailable : money(netProfit)],
    ["PO Commitments", backendError ? unavailable : money(poCommitments)],
  ];

  return (
    <>
      <div className="page-head">
        <div><h2>Management Dashboard</h2><p className="small">Fast management view from pre-calculated reporting summaries. Posted journal lines remain the accounting source of truth.</p></div>
        <div className="badge">GST: {gstStatus}</div>
      </div>

      {backendError && <section className="panel warning-panel"><strong>Financial data unavailable.</strong> {backendError} Do not rely on dashboard balances until this warning clears.</section>}

      <div className="grid dashboard-grid">
        {kpis.map(([label, value]) => <div className="card" key={label}><div className="label">{label}</div><div className="value">{value}</div></div>)}
      </div>

      <div className="two-col">
        <section className="panel">
          <h3>Control Snapshot</h3>
          <p>Pending finance approvals: <strong>{backendError ? "—" : draftApprovals}</strong></p>
          <p>Active projects: <strong>{backendError ? "—" : activeProjects}</strong></p>
          <p>Source files not retained: <strong>{backendError ? "—" : sourcePending}</strong></p>
          <p>AR subledger total: <strong>{backendError ? "Unavailable" : money(arSubledger)}</strong></p>
          <p>AP subledger total: <strong>{backendError ? "Unavailable" : money(apSubledger)}</strong></p>
          <p>AI auto-posting: <strong>Disabled</strong></p>
          <div className="button-row"><Link prefetch={false} className="link-button" href="/controls">Open Control Centre</Link><Link prefetch={false} className="link-button secondary-link" href="/reports">Open Reports</Link></div>
        </section>

        <section className="panel">
          <h3>Loan Control</h3>
          {backendError ? <p>Loan data unavailable while the backend warning is active.</p> : activeLoan ? <>
            <p>Lender: <strong>{String(get("loanLenderName"))}</strong></p>
            <p>Original principal: <strong>{money(n(get("loanPrincipal")))}</strong></p>
            <p>Interest: <strong>{(n(get("loanInterestRate")) * 100).toFixed(2)}% monthly compound</strong></p>
            <p>Principal outstanding: <strong>{money(n(get("loanPrincipalOutstanding")))}</strong></p>
            <p>Accrued interest outstanding: <strong>{money(n(get("loanInterestOutstanding")))}</strong></p>
            <p>Recorded total settlement: <strong>{money(n(get("loanExpectedSettlement")))}</strong></p>
            <p>Next accrual: <strong>{nextLoanAccrual || "—"}</strong></p>
            <Link prefetch={false} className="link-button" href="/loans/actions">Loan Actions</Link>
          </> : <p>No active loan loaded.</p>}
        </section>
      </div>

      <section className="panel">
        <h3>Accounting Policy</h3>
        <p>GST posting: <strong>{gstStatus === "VERIFIED" ? "Enabled for validated GST documents" : "Blocked until verification"}</strong></p>
        <p>Posted corrections: <strong>Reversal + corrected journal only</strong></p>
        <p>Source-document duplicates: <strong>SHA-256 controlled</strong></p>
      </section>
    </>
  );
}
