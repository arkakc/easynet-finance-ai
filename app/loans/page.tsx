import { formatAccountingDate } from "@/lib/accounting/format-date";
import { listTable } from "@/lib/backend/apps-script";
import { backendConfigStatus } from "@/lib/backend/apps-script";
import { completedMonthlyPeriods, monthlyAnniversaryDate, normalizeAccountingDate } from "@/lib/accounting/loan";
import { prisma } from "@/src/lib/prisma";

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
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      const result = await prisma.loan.findMany({ orderBy: { createdAt: "desc" } });
      loans = result.map((loan) => ({
        loanId: loan.code,
        lenderName: loan.lenderName,
        loanDate: loan.loanDate.toISOString(),
        principal: Number(loan.principal),
        interestRate: Number(loan.interestRate),
        contractInterest: Number(loan.contractInterest),
        principalOutstanding: Number(loan.principalOutstanding),
        interestOutstanding: Number(loan.interestOutstanding),
        expectedSettlement: Number(loan.expectedSettlement),
        lastAccruedThrough: loan.lastAccruedThrough?.toISOString() || "",
        firstAccrualDate: loan.firstAccrualDate?.toISOString() || "",
        status: loan.status,
        repaymentCondition: loan.repaymentCondition || "",
      }));
    } else {
      const result = await listTable<Loan>("Loans", 500, 0);
      loans = result.rows;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Unable to load loans";
  }

  const totalPrincipal = loans.reduce((sum, l) => sum + n(l.principal), 0);
  const totalPrincipalOut = loans.reduce((sum, l) => sum + n(l.principalOutstanding), 0);
  const totalInterestOut = loans.reduce((sum, l) => sum + n(l.interestOutstanding), 0);
  const totalSettlement = loans.reduce((sum, l) => sum + n(l.expectedSettlement), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Loan Register</h2>
          <p className="small">Recorded funding balances, lender covenants, and anniversary compound interest controls.</p>
        </div>
        <div className="page-head-actions">
          <div className="badge">{loans.length} LOAN{loans.length !== 1 ? "S" : ""} RECORDED</div>
          {error && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Loan data notice:</strong> {error}
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Original Principal</div>
          <div className="value">{money(totalPrincipal)}</div>
        </div>
        <div className="card">
          <div className="label">Principal Outstanding</div>
          <div className="value">{money(totalPrincipalOut)}</div>
        </div>
        <div className="card">
          <div className="label">Accrued Interest</div>
          <div className="value">{money(totalInterestOut)}</div>
        </div>
        <div className="card">
          <div className="label">Total Settlement</div>
          <div className="value">{money(totalSettlement)}</div>
        </div>
      </div>

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
