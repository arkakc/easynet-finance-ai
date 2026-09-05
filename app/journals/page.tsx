import { formatAccountingDate } from "@/lib/accounting/format-date";
import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Header = { journalId: string; postingDate: string; documentType: string; documentNumber: string; reference: string; projectId: string; status: string; approvedBy: string; postedAt: string };
type Line = { journalLineId: string; journalId: string; lineNo: number | string; accountId: string; customerId: string; supplierId: string; projectId: string; debit: number | string; credit: number | string; description: string };
type Account = { accountId: string; accountCode: string; accountName: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);

export default async function JournalsPage() {
  let headers: Header[] = [];
  let lines: Line[] = [];
  let accounts: Account[] = [];
  let error = "";
  try {
    const [h, l, a] = await Promise.all([
      listTable<Header>("JournalHeaders", 500, 0),
      listTable<Line>("JournalLines", 500, 0),
      listTable<Account>("Accounts", 500, 0),
    ]);
    headers = h.rows;
    lines = l.rows;
    accounts = a.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Journal load failed";
  }

  const account = new Map(accounts.map((row) => [row.accountId, `${row.accountCode} — ${row.accountName}`]));
  headers.sort((a, b) => String(b.postingDate).localeCompare(String(a.postingDate)));

  return (
    <>
      <h2>Posted Journals</h2>
      <p className="small">Read-only accounting ledger. Posted journals are not edited or deleted; corrections must use reversal and corrected entries.</p>
      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      {headers.map((header) => {
        const journalLines = lines.filter((line) => line.journalId === header.journalId).sort((a, b) => n(a.lineNo) - n(b.lineNo));
        const debit = journalLines.reduce((sum, line) => sum + n(line.debit), 0);
        const credit = journalLines.reduce((sum, line) => sum + n(line.credit), 0);
        return (
          <section className="panel" key={header.journalId}>
            <div className="journal-head">
              <div><strong>{header.journalId}</strong><br/><span className="small">{formatAccountingDate(header.postingDate)} · {header.documentType} · {header.documentNumber}</span></div>
              <div><strong>{header.status}</strong><br/><span className="small">Approved by {header.approvedBy || "—"}</span></div>
            </div>
            <p>{header.reference}</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>#</th><th>Account</th><th>Party</th><th>Project</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
                <tbody>{journalLines.map((line) => <tr key={line.journalLineId}><td>{line.lineNo}</td><td>{account.get(line.accountId) || line.accountId}</td><td>{line.customerId || line.supplierId || "—"}</td><td>{line.projectId || "—"}</td><td>{line.description}</td><td>{n(line.debit) ? money(n(line.debit)) : "—"}</td><td>{n(line.credit) ? money(n(line.credit)) : "—"}</td></tr>)}</tbody>
                <tfoot><tr><th colSpan={5}>Total</th><th>{money(debit)}</th><th>{money(credit)}</th></tr></tfoot>
              </table>
            </div>
          </section>
        );
      })}
      {!headers.length && !error && <section className="panel">No journals found.</section>}
    </>
  );
}
