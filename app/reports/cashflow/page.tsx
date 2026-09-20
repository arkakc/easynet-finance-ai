"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CashFlowStatement } from "@/lib/accounting/cash-flow";

const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);
const pngToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function CashFlowPage() {
  const [from, setFrom] = useState("");
  const [asOf, setAsOf] = useState(pngToday);
  const [statement, setStatement] = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ asOf });
      if (from) query.set("from", from);
      const response = await fetch(`/api/reports/cash-flow?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Cash-flow statement could not be loaded");
      setStatement(payload.statement);
    } catch (reason) {
      setStatement(null);
      setError(reason instanceof Error ? reason.message : "Cash-flow statement could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [asOf, from]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="page-head">
        <div><h2>Statement of Cash Flows</h2><p className="small">Direct-method cash movements across every mapped cash and bank GL account.</p></div>
        <div className="page-head-actions">
          <Link prefetch={false} className="button-link secondary-link" href="/reports">Financial Statements</Link>
          <Link prefetch={false} className="button-link secondary-link" href="/controls">Integrity Controls</Link>
        </div>
      </div>

      <section className="panel">
        <div className="form-grid">
          <label>Period From<input type="date" value={from} max={asOf} onChange={(event) => setFrom(event.target.value)} /><span className="small">Blank uses the configured fiscal-year start.</span></label>
          <label>As At<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
        </div>
        <div className="button-row"><button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Running…" : "Run Statement"}</button></div>
      </section>

      {error && <section className="panel warning-panel"><strong>Cash-flow unavailable.</strong> {error}</section>}
      {statement && <>
        <div className="grid dashboard-grid">
          <div className="card"><div className="label">Opening Cash</div><div className="value">{money(statement.totals.openingCash)}</div></div>
          <div className="card"><div className="label">Operating Cash Flow</div><div className="value">{money(statement.totals.operating)}</div></div>
          <div className="card"><div className="label">Investing Cash Flow</div><div className="value">{money(statement.totals.investing)}</div></div>
          <div className="card"><div className="label">Financing Cash Flow</div><div className="value">{money(statement.totals.financing)}</div></div>
          <div className="card"><div className="label">Net Cash Change</div><div className="value">{money(statement.totals.netChange)}</div></div>
          <div className="card"><div className="label">Closing Cash</div><div className="value">{money(statement.totals.closingCash)}</div></div>
          <div className="card"><div className="label">GL Closing Cash</div><div className="value">{money(statement.control.ledgerClosingCash)}</div></div>
          <div className="card"><div className="label">Control Difference</div><div className="value">{money(statement.control.difference)}</div><span className="auto-badge">{statement.control.balanced ? "BALANCED" : "REVIEW"}</span></div>
        </div>

        <section className="panel table-wrap">
          <div className="form-title-row"><div><h3>Cash & Bank Movements</h3><p className="small">Period {statement.period.from} to {statement.period.asOf}. Opening journals are carried into opening cash, not reported as operating inflow.</p></div><span className="auto-badge">{statement.rows.length} entries</span></div>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Journal</th><th>Category</th><th>Source</th><th>Reference / Description</th><th>Inflow</th><th>Outflow</th></tr></thead>
            <tbody>
              {statement.rows.map((row) => <tr key={row.journalId}>
                <td>{row.date}</td>
                <td><Link href={`/journals/${encodeURIComponent(row.journalId)}`}><strong>{row.journalCode}</strong></Link></td>
                <td><span className="auto-badge">{row.category}</span></td>
                <td>{row.documentType}</td>
                <td>{row.reference || "—"}<br /><span className="small">{row.description}</span></td>
                <td>{row.movement > 0 ? money(row.movement) : "—"}</td>
                <td>{row.movement < 0 ? money(Math.abs(row.movement)) : "—"}</td>
              </tr>)}
              {!statement.rows.length && <tr><td colSpan={7}>No posted cash movements in this period.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="panel table-wrap">
          <div className="form-title-row"><h3>Included Cash Accounts</h3><span className="badge">{statement.cashAccounts.length} GL accounts</span></div>
          <table className="data-table"><thead><tr><th>Code</th><th>Name</th></tr></thead><tbody>{statement.cashAccounts.map((account) => <tr key={account.code}><td><strong>{account.code}</strong></td><td>{account.name}</td></tr>)}</tbody></table>
        </section>
      </>}
    </>
  );
}
