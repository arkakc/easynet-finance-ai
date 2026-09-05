import { formatAccountingDate } from "@/lib/accounting/format-date";
import { listTable } from "@/lib/backend/apps-script";
import { completedMonthlyPeriods, monthlyAnniversaryDate, normalizeAccountingDate } from "@/lib/accounting/loan";

export const dynamic = "force-dynamic";

type Loan = {
  loanId: string;
  lenderName: string;
  loanDate: string;
  principal: number | string;
  interestRate: number | string;
  contractInterest: number | string;
  principalOutstanding: number | string;
  interestOutstanding: number | string;
  expectedSettlement: number | string;
  lastAccruedThrough: string;
  firstAccrualDate: string;
  status: string;
  repaymentCondition: string;
};

const n = (value: number | string | undefined) => Number(value || 0);
const money = (value: number) =>
  new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);

function nextAccrual(loan: Loan) {
  try {
    const loanDate = normalizeAccountingDate(loan.loanDate);
    const lastAccrued = normalizeAccountingDate(loan.lastAccruedThrough || loanDate);
    return monthlyAnniversaryDate(loanDate, completedMonthlyPeriods(loanDate, lastAccrued) + 1);
  } catch {
    return loan.firstAccrualDate || "Review required";
  }
}

export default async function LoansPage() {
  let loans: Loan[] = [];
  let error = "";
  try {
    const result = await listTable<Loan>("Loans", 500, 0);
    loans = result.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unable to load loans";
  }

  return (
    <>
      <h2>Loan Register</h2>
      <p className="small">Recorded funding balances and anniversary-based compound interest controls.</p>
      {error && <section className="panel warning-panel"><strong>Loan data unavailable.</strong> {error}</section>}

      <section className="panel table-wrap">
        <table className="data-table">
          <thead><tr><th>Loan</th><th>Lender</th><th>Date</th><th>Original Principal</th><th>Rate</th><th>Principal Outstanding</th><th>Interest Outstanding</th><th>Total Settlement</th><th>Next Accrual</th><th>Status</th></tr></thead>
          <tbody>
            {loans.map((loan) => (
              <tr key={loan.loanId}>
                <td>{loan.loanId}</td><td>{loan.lenderName}</td><td>{formatAccountingDate(loan.loanDate)}</td><td>{money(n(loan.principal))}</td>
                <td>{(n(loan.interestRate) * 100).toFixed(2)}% monthly</td>
                <td>{money(n(loan.principalOutstanding))}</td><td>{money(n(loan.interestOutstanding))}</td>
                <td>{money(n(loan.expectedSettlement))}</td><td>{formatAccountingDate(nextAccrual(loan))}</td><td>{loan.status}</td>
              </tr>
            ))}
            {!loans.length && !error && <tr><td colSpan={10}>No loans found.</td></tr>}
          </tbody>
        </table>
      </section>

      {loans.map((loan) => (
        <section className="panel" key={`${loan.loanId}-terms`}>
          <h3>{loan.loanId} — Repayment Control</h3>
          <p>{loan.repaymentCondition || "No repayment condition recorded."}</p>
          <p className="small">Interest is recognized only through approved accrual actions; future compound interest is not booked automatically.</p>
        </section>
      ))}
    </>
  );
}
