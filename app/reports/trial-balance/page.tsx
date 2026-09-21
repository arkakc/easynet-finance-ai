"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { TrialBalance } from "@/lib/accounting/trial-balance";

const pngToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Port_Moresby",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-PG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);

export default function TrialBalancePage() {
  const [startDate, setStartDate] = useState("");
  const [asOf, setAsOf] = useState(pngToday);
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ asOf });
      if (startDate) query.set("startDate", startDate);
      const response = await fetch(`/api/reports/trial-balance?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Trial Balance could not be loaded");
      setData(payload.trialBalance);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Trial Balance could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [asOf, startDate]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const rows: Array<Array<string | number>> = [
      ["Easynet Trial Balance"],
      ["Period From", data.period.startDate || "Opening", "As At", data.period.asOf],
      ["Base Currency", data.currency],
      [],
      ["Account", "Name", "Type", `Debit (${data.currency})`, `Credit (${data.currency})`, `Net (${data.currency})`],
      ...data.accounts.map((row) => [
        row.accountCode,
        row.accountName,
        row.accountType,
        row.debit,
        row.credit,
        row.balance,
      ]),
      [],
      ["", "TOTAL", "", data.totals.debit, data.totals.credit, data.totals.difference],
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `easynet-trial-balance-${data.period.asOf}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Trial Balance</h2>
          <p className="small">Posted general-ledger debit and credit totals in the configured company base currency.</p>
        </div>
        <div className="page-head-actions">
          <Link prefetch={false} className="button-link secondary-link" href="/reports">Financial Statements</Link>
          <Link prefetch={false} className="button-link secondary-link" href="/reports/cashflow">Cash Flow</Link>
          <Link prefetch={false} className="button-link secondary-link" href="/controls">Integrity Controls</Link>
        </div>
      </div>

      <section className="panel">
        <div className="form-grid">
          <label>
            Period From
            <input type="date" value={startDate} max={asOf} onChange={(event) => setStartDate(event.target.value)} />
            <span className="small">Blank includes all posted ledger history through the As At date.</span>
          </label>
          <label>
            As At
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Running…" : "Run Trial Balance"}</button>
          <button type="button" className="secondary" onClick={exportCsv} disabled={!data}>Export CSV</button>
        </div>
      </section>

      {error && <section className="panel warning-panel"><strong>Trial Balance unavailable.</strong> {error}</section>}

      {data && (
        <>
          <div className="grid">
            <div className="card"><div className="label">Total Debit</div><div className="value">{money(data.totals.debit, data.currency)}</div></div>
            <div className="card"><div className="label">Total Credit</div><div className="value">{money(data.totals.credit, data.currency)}</div></div>
            <div className="card"><div className="label">Difference</div><div className="value">{money(data.totals.difference, data.currency)}</div></div>
            <div className="card">
              <div className="label">Control</div>
              <div className="value small-value">{data.totals.balanced ? "BALANCED" : "REVIEW"}</div>
              <span className="auto-badge">{data.currency}</span>
            </div>
          </div>

          <section className="panel table-wrap">
            <div className="form-title-row">
              <div>
                <h3>Posted Ledger Balances</h3>
                <p className="small">
                  {data.period.startDate ? `${data.period.startDate} to ${data.period.asOf}` : `Through ${data.period.asOf}`}
                </p>
              </div>
              <span className="auto-badge">{data.accounts.length} Accounts</span>
            </div>
            <table className="data-table" style={{ minWidth: 900 }}>
              <thead>
                <tr><th>Account</th><th>Name</th><th>Type</th><th>Debit</th><th>Credit</th><th>Net Dr/(Cr)</th></tr>
              </thead>
              <tbody>
                {data.accounts.map((row) => <tr key={row.accountId}>
                  <td><strong>{row.accountCode}</strong></td>
                  <td>{row.accountName}</td>
                  <td>{row.accountType}</td>
                  <td>{money(row.debit, data.currency)}</td>
                  <td>{money(row.credit, data.currency)}</td>
                  <td>{money(row.balance, data.currency)}</td>
                </tr>)}
                {!data.accounts.length && <tr><td colSpan={6}>No posted journal activity in this period.</td></tr>}
                <tr>
                  <th colSpan={3}>TOTAL</th>
                  <th>{money(data.totals.debit, data.currency)}</th>
                  <th>{money(data.totals.credit, data.currency)}</th>
                  <th>{money(data.totals.difference, data.currency)}</th>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
