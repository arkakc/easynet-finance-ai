import Link from "next/link";
import { backendConfigStatus, listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

type Header = { journalId: string; postingDate: string; documentType: string; documentNumber: string; reference: string; status: string };
type Line = { journalId: string; accountId: string; debit: number | string; credit: number | string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(n(value));
const normalized = (value: unknown) => String(value || "").trim().toUpperCase();

function category(documentType: string) {
  const type = normalized(documentType);
  if (["FUNDING_LOAN", "LOAN_REPAYMENT"].includes(type)) return "Financing";
  if (["ASSET_PURCHASE", "ASSET_DISPOSAL"].includes(type)) return "Investing";
  return "Operating";
}

export default async function CashFlowPage() {
  let headers: Header[] = [];
  let lines: Line[] = [];
  let error = "";
  try {
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      const [h, l] = await Promise.all([
        prisma.journalHeader.findMany({ where: { status: "POSTED" } }),
        prisma.journalLine.findMany({ include: { account: true } }),
      ]);
      headers = h.map((row) => ({ journalId: row.code, postingDate: row.date.toISOString(), documentType: row.sourceDocType || "JOURNAL", documentNumber: row.sourceDocId || "", reference: row.reference || row.description, status: row.status }));
      const codeById = new Map(h.map((row) => [row.id, row.code]));
      lines = l.map((row) => ({ journalId: codeById.get(row.journalId) || row.journalId, accountId: `ACC-${row.account.code}`, debit: Number(row.debit), credit: Number(row.credit) }));
    } else {
      const [h, l] = await Promise.all([listTable<Header>("JournalHeaders", 500, 0), listTable<Line>("JournalLines", 500, 0)]);
      headers = h.rows.filter((row) => normalized(row.status) === "POSTED"); lines = l.rows;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Cash-flow load failed";
  }

  const cashAccounts = new Set(["ACC-1110", "ACC-1120", "ACC-1121"]);
  const rows = headers.map((header) => {
    const cashMovement = lines
      .filter((line) => String(line.journalId) === String(header.journalId) && cashAccounts.has(String(line.accountId)))
      .reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0);
    return { ...header, cashMovement, category: category(header.documentType) };
  }).filter((row) => Math.abs(row.cashMovement) > 0.0001).sort((a, b) => String(a.postingDate).localeCompare(String(b.postingDate)));

  const operating = rows.filter((r) => r.category === "Operating").reduce((sum, r) => sum + r.cashMovement, 0);
  const investing = rows.filter((r) => r.category === "Investing").reduce((sum, r) => sum + r.cashMovement, 0);
  const financing = rows.filter((r) => r.category === "Financing").reduce((sum, r) => sum + r.cashMovement, 0);
  const net = operating + investing + financing;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Statement of Cash Flows</h2>
          <p className="small">Operating, investing and financing liquidity movement derived exclusively from POSTED journals.</p>
        </div>
        <div className="page-head-actions">
          {error && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Cash-flow notice:</strong> {error}
              </div>
            </details>
          )}
          <Link prefetch={false} className="button-link secondary-link" href="/reports">
            ← Financial Reports
          </Link>
          <Link prefetch={false} className="button-link secondary-link" href="/controls">
            Integrity Controls
          </Link>
          <span className="badge">PGK (K)</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Operating Cash Flow</div>
          <div className="value">{money(operating)}</div>
        </div>
        <div className="card">
          <div className="label">Investing Cash Flow</div>
          <div className="value">{money(investing)}</div>
        </div>
        <div className="card">
          <div className="label">Financing Cash Flow</div>
          <div className="value">{money(financing)}</div>
        </div>
        <div className="card">
          <div className="label">Net Cash Movement</div>
          <div className="value">{money(net)}</div>
        </div>
      </div>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>Cash & Bank Movements</h3>
          <span className="auto-badge">{rows.length} Posted Entries</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Posting Date</th>
              <th>Category</th>
              <th>Document Type</th>
              <th>Reference</th>
              <th>Inflow (PGK)</th>
              <th>Outflow (PGK)</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.journalId}>
                <td>{row.postingDate}</td>
                <td><span className="auto-badge">{row.category}</span></td>
                <td>{row.documentType}</td>
                <td>
                  <strong>{row.documentNumber || "—"}</strong>
                  <br />
                  <span className="small">{row.reference || "—"}</span>
                </td>
                <td>{row.cashMovement > 0 ? money(row.cashMovement) : "—"}</td>
                <td>{row.cashMovement < 0 ? money(Math.abs(row.cashMovement)) : "—"}</td>
                <td>
                  <Link className="button-link secondary-link" href={`/journals/${encodeURIComponent(row.journalId)}`}>
                    View Journal
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7}>No posted cash or bank movements found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
