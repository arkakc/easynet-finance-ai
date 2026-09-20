import { formatAccountingDate } from "@/lib/accounting/format-date";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

type Header = {
  journalId: string;
  postingDate: string;
  documentType: string;
  documentNumber: string;
  reference: string;
  projectId: string;
  status: string;
  approvedBy: string;
  postedAt: string;
  createdAt?: string;
};

type Line = {
  journalLineId: string;
  journalId: string;
  lineNo: number | string;
  accountId: string;
  customerId: string;
  supplierId: string;
  projectId: string;
  debit: number | string;
  credit: number | string;
  description: string;
};

type Account = { accountId: string; accountCode: string; accountName: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: number) =>
  new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);

const createdValue = (row: Header) => {
  const value = row.createdAt || row.postedAt || row.postingDate || "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const createdLabel = (row: Header) => {
  const value = row.createdAt || row.postedAt || "";
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-PG", {
        timeZone: "Pacific/Port_Moresby",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date)
    : String(value);
};

export default async function JournalsPage() {
  let headers: Header[] = [];
  let lines: Line[] = [];
  let accounts: Account[] = [];
  let error = "";

  try {
    const [journalHeaders, journalLines, chartOfAccounts] = await Promise.all([
      prisma.journalHeader.findMany({ where: { status: "POSTED" }, orderBy: { createdAt: "desc" } }),
      prisma.journalLine.findMany({ where: { journal: { status: "POSTED" } }, orderBy: { lineNo: "asc" } }),
      prisma.chartOfAccounts.findMany({ orderBy: { code: "asc" } }),
    ]);

    headers = journalHeaders.map((row) => ({
      journalId: row.code,
      postingDate: row.date.toISOString(),
      documentType: row.sourceDocType || "JOURNAL",
      documentNumber: row.sourceDocId || "",
      reference: row.reference || row.description,
      projectId: "",
      status: row.status,
      approvedBy: row.approvedBy || "",
      postedAt: row.postedAt?.toISOString() || "",
      createdAt: row.createdAt.toISOString(),
    }));

    const journalCodeById = new Map(journalHeaders.map((row) => [row.id, row.code]));
    lines = journalLines.map((row) => ({
      journalLineId: row.id,
      journalId: journalCodeById.get(row.journalId) || row.journalId,
      lineNo: row.lineNo,
      accountId: row.accountId,
      customerId: row.customerId || "",
      supplierId: row.supplierId || "",
      projectId: row.projectId || "",
      debit: Number(row.debit),
      credit: Number(row.credit),
      description: row.description,
    }));

    accounts = chartOfAccounts.map((row) => ({
      accountId: row.id,
      accountCode: row.code,
      accountName: row.name,
    }));
  } catch (err) {
    error = err instanceof Error ? err.message : "Journal load failed";
  }

  const account = new Map(accounts.map((row) => [row.accountId, `${row.accountCode} — ${row.accountName}`]));
  headers.sort((a, b) => createdValue(b) - createdValue(a));
  const totalDebits = lines.reduce((sum, line) => sum + n(line.debit), 0);
  const totalCredits = lines.reduce((sum, line) => sum + n(line.credit), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Posted Journals</h2>
          <p className="small">Papua New Guinea immutable accounting ledger · Prisma authoritative source.</p>
        </div>
        <div className="page-head-actions">
          <div className="badge">{isBalanced ? "✓ BALANCED" : "⚠️ UNBALANCED"}</div>
          {error && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Database warning:</strong> {error}
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Posted Journals</div>
          <div className="value">{headers.length}</div>
        </div>
        <div className="card">
          <div className="label">Total Debits</div>
          <div className="value">{money(totalDebits)}</div>
        </div>
        <div className="card">
          <div className="label">Total Credits</div>
          <div className="value">{money(totalCredits)}</div>
        </div>
        <div className="card">
          <div className="label">Ledger Integrity</div>
          <div className="value small-value" style={{ color: isBalanced ? "var(--soft-emerald-text)" : "var(--soft-rose-text)" }}>
            {isBalanced ? "100% Balanced" : "Check Exceptions"}
          </div>
        </div>
      </div>

      {headers.map((header) => {
        const journalLines = lines
          .filter((line) => line.journalId === header.journalId)
          .sort((a, b) => n(a.lineNo) - n(b.lineNo));
        const debit = journalLines.reduce((sum, line) => sum + n(line.debit), 0);
        const credit = journalLines.reduce((sum, line) => sum + n(line.credit), 0);

        return (
          <section className="panel" key={header.journalId}>
            <div className="journal-head">
              <div>
                <strong>{header.journalId}</strong>
                <br />
                <span className="small">
                  Created {createdLabel(header)} · Posting {formatAccountingDate(header.postingDate)} · {header.documentType} · {header.documentNumber}
                </span>
              </div>
              <div>
                <strong>{header.status}</strong>
                <br />
                <span className="small">Approved by {header.approvedBy || "—"}</span>
              </div>
            </div>

            <p>{header.reference}</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Account</th>
                    <th>Party</th>
                    <th>Project</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {journalLines.map((line) => (
                    <tr key={line.journalLineId}>
                      <td>{line.lineNo}</td>
                      <td>{account.get(line.accountId) || line.accountId}</td>
                      <td>{line.customerId || line.supplierId || "—"}</td>
                      <td>{line.projectId || "—"}</td>
                      <td>{line.description}</td>
                      <td>{n(line.debit) ? money(n(line.debit)) : "—"}</td>
                      <td>{n(line.credit) ? money(n(line.credit)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={5}>Total</th>
                    <th>{money(debit)}</th>
                    <th>{money(credit)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}

      {!headers.length && !error && <section className="panel">No journals found.</section>}
    </>
  );
}
