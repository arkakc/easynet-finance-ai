import { listTable } from "@/lib/backend/apps-script";
import { calculateCompoundMonthlyLoan } from "@/lib/accounting/loan";

export const dynamic = "force-dynamic";

type Loan = {
  loanId: string;
  lenderName: string;
  loanDate: string;
  principal: number | string;
  interestRate: number | string;
  principalRepaid: number | string;
  interestPaid: number | string;
  status: string;
  repaymentCondition: string;
};

const n = (value: number | string | undefined) => Number(value || 0);
const money = (value: number) =>
  new Intl.NumberFormat("en-PG", {
    style: "currency",
    currency: "PGK",
    minimumFractionDigits: 2,
  }).format(value);

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
      <p className="small">
        Live funding register with contract terms and calculated compound-monthly exposure.
      </p>

      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      <section className="panel table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Loan</th>
              <th>Lender</th>
              <th>Date</th>
              <th>Principal</th>
              <th>Rate</th>
              <th>Accrued Interest</th>
              <th>Total Outstanding</th>
              <th>Next Accrual</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => {
              const snapshot = calculateCompoundMonthlyLoan({
                principal: n(loan.principal),
                monthlyRate: n(loan.interestRate),
                loanDate: loan.loanDate,
                principalRepaid: n(loan.principalRepaid),
                interestPaid: n(loan.interestPaid),
              });

              return (
                <tr key={loan.loanId}>
                  <td>{loan.loanId}</td>
                  <td>{loan.lenderName}</td>
                  <td>{loan.loanDate}</td>
                  <td>{money(n(loan.principal))}</td>
                  <td>{(n(loan.interestRate) * 100).toFixed(2)}% monthly</td>
                  <td>{money(snapshot.accruedInterest)}</td>
                  <td>{money(snapshot.totalOutstanding)}</td>
                  <td>{snapshot.nextAccrualDate}</td>
                  <td>{loan.status}</td>
                </tr>
              );
            })}
            {!loans.length && !error && (
              <tr><td colSpan={9}>No loans found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {loans.map((loan) => (
        <section className="panel" key={`${loan.loanId}-terms`}>
          <h3>{loan.loanId} — Repayment Control</h3>
          <p>{loan.repaymentCondition || "No repayment condition recorded."}</p>
        </section>
      ))}
    </>
  );
}
