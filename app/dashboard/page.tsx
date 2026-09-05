import Link from "next/link";
import { listTable } from "@/lib/backend/apps-script";
import { completedMonthlyPeriods, monthlyAnniversaryDate, normalizeAccountingDate } from "@/lib/accounting/loan";

export const dynamic = "force-dynamic";

type JournalLine = { accountId: string; debit: number | string; credit: number | string };
type Account = { accountId: string; accountType: string };
type Loan = { lenderName: string; loanDate: string; principal: number | string; interestRate: number | string; principalRepaid: number | string; interestPaid: number | string; contractInterest: number | string; principalOutstanding: number | string; interestOutstanding: number | string; expectedSettlement: number | string; lastAccruedThrough: string; firstAccrualDate: string; status: string };
type Invoice = { status: string; outstandingAmount: number | string };
type Bill = { status: string; outstandingAmount: number | string };
type PO = { status: string; totalAmount: number | string };
type Project = { status: string };
type Setting = { key: string; value: string };
type Doc = { driveFileId: string; status: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);

export default async function DashboardPage() {
  let lines: JournalLine[] = [];
  let accounts: Account[] = [];
  let loans: Loan[] = [];
  let invoices: Invoice[] = [];
  let bills: Bill[] = [];
  let pos: PO[] = [];
  let projects: Project[] = [];
  let settings: Setting[] = [];
  let docs: Doc[] = [];
  let backendError = "";

  try {
    const [lineResult, accountResult, loanResult, invoiceResult, billResult, poResult, projectResult, settingResult, docResult] = await Promise.all([
      listTable<JournalLine>("JournalLines", 500, 0),
      listTable<Account>("Accounts", 500, 0),
      listTable<Loan>("Loans", 100, 0),
      listTable<Invoice>("Invoices", 500, 0),
      listTable<Bill>("SupplierBills", 500, 0),
      listTable<PO>("PurchaseOrders", 500, 0),
      listTable<Project>("Projects", 500, 0),
      listTable<Setting>("Settings", 500, 0),
      listTable<Doc>("Documents", 500, 0),
    ]);
    lines = lineResult.rows;
    accounts = accountResult.rows;
    loans = loanResult.rows;
    invoices = invoiceResult.rows;
    bills = billResult.rows;
    pos = poResult.rows;
    projects = projectResult.rows;
    settings = settingResult.rows;
    docs = docResult.rows;
  } catch (error) {
    backendError = error instanceof Error ? error.message : "Backend read failed";
  }

  const accountType = new Map(accounts.map((a) => [a.accountId, a.accountType]));
  const balanceFor = (ids: string[]) => lines.filter((line) => ids.includes(line.accountId)).reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0);
  const cashBank = balanceFor(["ACC-1110", "ACC-1120"]);
  const accountsReceivable = balanceFor(["ACC-1130"]);
  const accountsPayable = -balanceFor(["ACC-2110"]);
  const gstPayable = -balanceFor(["ACC-2120"]);

  let revenue = 0;
  let expenses = 0;
  for (const line of lines) {
    const type = accountType.get(line.accountId);
    if (type === "Income") revenue += n(line.credit) - n(line.debit);
    if (type === "Expense") expenses += n(line.debit) - n(line.credit);
  }
  const netProfit = revenue - expenses;
  const activeLoan = loans.find((loan) => String(loan.status).toUpperCase() === "ACTIVE");
  let nextLoanAccrual = "";
  if (activeLoan) {
    try {
      const loanDate = normalizeAccountingDate(activeLoan.loanDate);
      const lastAccrued = normalizeAccountingDate(activeLoan.lastAccruedThrough || loanDate);
      const recognizedPeriods = completedMonthlyPeriods(loanDate, lastAccrued);
      nextLoanAccrual = monthlyAnniversaryDate(loanDate, recognizedPeriods + 1);
    } catch {
      nextLoanAccrual = activeLoan.firstAccrualDate || "Review required";
    }
  }

  const gstStatus = settings.find((row) => row.key === "gst_status")?.value || "UNVERIFIED";
  const draftApprovals = invoices.filter((row) => row.status === "DRAFT").length + bills.filter((row) => row.status === "DRAFT").length;
  const arSubledger = invoices.filter((row) => row.status !== "DRAFT").reduce((sum, row) => sum + n(row.outstandingAmount), 0);
  const apSubledger = bills.filter((row) => row.status !== "DRAFT").reduce((sum, row) => sum + n(row.outstandingAmount), 0);
  const poCommitments = pos.filter((row) => !["CANCELLED", "BILLED"].includes(String(row.status).toUpperCase())).reduce((sum, row) => sum + n(row.totalAmount), 0);
  const activeProjects = projects.filter((row) => ["OPEN", "ACTIVE", "ON HOLD"].includes(String(row.status).toUpperCase())).length;
  const sourcePending = docs.filter((row) => !row.driveFileId).length;

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
        <div><h2>Management Dashboard</h2><p className="small">Live finance position from Google Sheets. Posted journal lines remain the accounting source of truth.</p></div>
        <div className="badge">GST: {gstStatus}</div>
      </div>

      {backendError && <section className="panel warning-panel"><strong>Financial data unavailable.</strong> Backend connection failed: {backendError}. Do not rely on dashboard balances until this warning clears.</section>}

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
          <div className="button-row"><Link className="link-button" href="/controls">Open Control Centre</Link><Link className="link-button secondary-link" href="/reports">Open Reports</Link></div>
        </section>

        <section className="panel">
          <h3>Loan Control</h3>
          {backendError ? <p>Loan data unavailable while the backend warning is active.</p> : activeLoan ? <>
            <p>Lender: <strong>{activeLoan.lenderName}</strong></p>
            <p>Original principal: <strong>{money(n(activeLoan.principal))}</strong></p>
            <p>Interest: <strong>{(n(activeLoan.interestRate) * 100).toFixed(2)}% monthly compound</strong></p>
            <p>Principal outstanding: <strong>{money(n(activeLoan.principalOutstanding))}</strong></p>
            <p>Accrued interest outstanding: <strong>{money(n(activeLoan.interestOutstanding))}</strong></p>
            <p>Recorded total settlement: <strong>{money(n(activeLoan.expectedSettlement))}</strong></p>
            <p>Next accrual: <strong>{nextLoanAccrual || "—"}</strong></p>
            <Link className="link-button" href="/loans/actions">Loan Actions</Link>
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
