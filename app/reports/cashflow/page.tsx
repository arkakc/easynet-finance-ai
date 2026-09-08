import Link from "next/link";
import { listTable } from "@/lib/backend/apps-script";

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
    const [h, l] = await Promise.all([
      listTable<Header>("JournalHeaders", 500, 0),
      listTable<Line>("JournalLines", 500, 0),
    ]);
    headers = h.rows.filter((row) => normalized(row.status) === "POSTED");
    lines = l.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Cash-flow load failed";
  }

  if (error) {
    return (
      <>
        <h2>Cash Flow</h2>
        <p className="small">Live finance data is unavailable until the backend connection succeeds.</p>
        <section className="panel warning-panel"><strong>Cash-flow data unavailable.</strong> {error}. Do not rely on zero or blank figures while this warning is active.</section>
      </>
    );
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
      <h2>Cash Flow</h2>
      <p className="small">Cash, operating bank and savings/reserve bank movement derived only from POSTED journal entries.</p>
      <div className="grid">
        <div className="card"><div className="label">Operating</div><div className="value">{money(operating)}</div></div>
        <div className="card"><div className="label">Investing</div><div className="value">{money(investing)}</div></div>
        <div className="card"><div className="label">Financing</div><div className="value">{money(financing)}</div></div>
        <div className="card"><div className="label">Net Cash Movement</div><div className="value">{money(net)}</div></div>
      </div>
      <section className="panel table-wrap">
        <table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Type</th><th>Reference</th><th>Inflow</th><th>Outflow</th><th>Journal</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.journalId}><td>{row.postingDate}</td><td>{row.category}</td><td>{row.documentType}</td><td>{row.documentNumber}<br/><span className="small">{row.reference}</span></td><td>{row.cashMovement > 0 ? money(row.cashMovement) : "—"}</td><td>{row.cashMovement < 0 ? money(Math.abs(row.cashMovement)) : "—"}</td><td><Link href={`/journals/${encodeURIComponent(row.journalId)}`}>View</Link></td></tr>)}
          {!rows.length && <tr><td colSpan={7}>No posted cash or bank movements.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
