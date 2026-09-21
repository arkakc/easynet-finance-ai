"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AgingBucket, FinancialStatements, StatementAccountRow } from "@/lib/accounting/financial-statements";

const money = (value: number, currency = "PGK") =>
  new Intl.NumberFormat("en-PG", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
const pngToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const BUCKETS: AgingBucket[] = ["Current", "1-30", "31-60", "61-90", "90+"];

function Status({ ok, good = "PASS", bad = "REVIEW" }: { ok: boolean; good?: string; bad?: string }) {
  return <span className="auto-badge" style={ok ? undefined : { background: "#fee2e2", borderColor: "#fecaca", color: "#991b1b" }}>{ok ? good : bad}</span>;
}

function AccountTable({ title, rows, total, currency }: { title: string; rows: StatementAccountRow[]; total: number; currency: string }) {
  return (
    <section className="panel table-wrap">
      <div className="form-title-row"><h3>{title}</h3><strong>{money(total, currency)}</strong></div>
      <table className="data-table">
        <thead><tr><th>Account</th><th>Name</th><th>Amount ({currency})</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.code}><td><strong>{row.code}</strong></td><td>{row.name}</td><td>{money(row.amount, currency)}</td></tr>)}
          {!rows.length && <tr><td colSpan={3}>No posted activity in this section.</td></tr>}
          <tr><th colSpan={2}>Total</th><th>{money(total, currency)}</th></tr>
        </tbody>
      </table>
    </section>
  );
}

export default function ReportsPage() {
  const [asOf, setAsOf] = useState(pngToday);
  const [from, setFrom] = useState("");
  const [data, setData] = useState<FinancialStatements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ asOf });
      if (from) query.set("from", from);
      const response = await fetch(`/api/reports/financial-statements?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Financial statements could not be loaded");
      setData(payload.statements);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Financial statements could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [asOf, from]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  const exportCsv = () => {
    if (!data) return;
    const rows: Array<Array<string | number>> = [["Easynet Financial Statements"], ["Period", data.period.from, data.period.asOf], ["Base Currency", data.currency], [], ["Profit & Loss"], ["Account", "Name", `Amount (${data.currency})`]];
    for (const row of [...data.profitAndLoss.revenue, ...data.profitAndLoss.expenses]) rows.push([row.code, row.name, row.amount]);
    rows.push(["", "Net profit / (loss)", data.profitAndLoss.totals.netProfit], [], ["Balance Sheet"], ["Account", "Name", `Amount (${data.currency})`]);
    for (const row of [...data.balanceSheet.assets, ...data.balanceSheet.liabilities, ...data.balanceSheet.equity]) rows.push([row.code, row.name, row.amount]);
    rows.push(["", "Accounting equation difference", data.balanceSheet.totals.difference]);
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `easynet-financial-statements-${data.period.asOf}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-head">
        <div><h2>Financial Statements Centre</h2><p className="small">Auditable base-currency statements derived only from posted general-ledger journals.</p></div>
        <div className="page-head-actions">
          <Link prefetch={false} className="button-link secondary-link" href="/reports/trial-balance">Trial Balance</Link>
          <Link prefetch={false} className="button-link secondary-link" href="/reports/cashflow">Cash Flow</Link>
          <Link prefetch={false} className="button-link secondary-link" href="/reports/gst">IRC GST</Link>
          <Link prefetch={false} className="button-link secondary-link" href="/controls">Integrity Controls</Link>
        </div>
      </div>

      <section className="panel">
        <div className="form-grid">
          <label>Period From<input type="date" value={from} max={asOf} onChange={(event) => setFrom(event.target.value)} /><span className="small">Blank uses the configured fiscal-year start.</span></label>
          <label>As At<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void loadReport()} disabled={loading}>{loading ? "Running…" : "Run Report"}</button>
          <button type="button" className="secondary" onClick={exportCsv} disabled={!data}>Export CSV</button>
        </div>
      </section>

      {error && <section className="panel warning-panel"><strong>Report unavailable.</strong> {error}</section>}
      {data && (
        <>
          <div className="grid">
            <div className="card"><div className="label">Revenue</div><div className="value">{money(data.profitAndLoss.totals.revenue, data.currency)}</div></div>
            <div className="card"><div className="label">Expenses</div><div className="value">{money(data.profitAndLoss.totals.expenses, data.currency)}</div></div>
            <div className="card"><div className="label">Net Profit / (Loss)</div><div className="value">{money(data.profitAndLoss.totals.netProfit, data.currency)}</div></div>
            <div className="card"><div className="label">Balance Sheet Control</div><div className="value">{money(data.balanceSheet.totals.difference, data.currency)}</div><Status ok={data.balanceSheet.totals.balanced} good="BALANCED" bad="OUT OF BALANCE" /></div>
          </div>

          <section className="panel table-wrap">
            <div className="form-title-row"><div><h3>Financial Control Summary</h3><p className="small">Period {data.period.from} to {data.period.asOf}</p></div><span className="badge">{data.currency}</span></div>
            <table className="data-table"><thead><tr><th>Control</th><th>Ledger</th><th>Comparison</th><th>Difference</th><th>Status</th></tr></thead><tbody>
              <tr><td>Period debit = credit</td><td>{money(data.controls.periodLedger.debit, data.currency)}</td><td>{money(data.controls.periodLedger.credit, data.currency)}</td><td>{money(data.controls.periodLedger.difference, data.currency)}</td><td><Status ok={data.controls.periodLedger.balanced} /></td></tr>
              <tr><td>Cumulative debit = credit</td><td>{money(data.controls.cumulativeLedger.debit, data.currency)}</td><td>{money(data.controls.cumulativeLedger.credit, data.currency)}</td><td>{money(data.controls.cumulativeLedger.difference, data.currency)}</td><td><Status ok={data.controls.cumulativeLedger.balanced} /></td></tr>
              <tr><td>AR {data.controls.receivables.accountCode} = customer subledger</td><td>{money(data.controls.receivables.glBalance, data.currency)}</td><td>{money(data.controls.receivables.subledgerBalance, data.currency)}</td><td>{money(data.controls.receivables.difference, data.currency)}</td><td><Status ok={data.controls.receivables.matched} /></td></tr>
              <tr><td>AP {data.controls.payables.accountCode} = supplier subledger</td><td>{money(data.controls.payables.glBalance, data.currency)}</td><td>{money(data.controls.payables.subledgerBalance, data.currency)}</td><td>{money(data.controls.payables.difference, data.currency)}</td><td><Status ok={data.controls.payables.matched} /></td></tr>
            </tbody></table>
          </section>

          <div className="two-col">
            <AccountTable title="Revenue" rows={data.profitAndLoss.revenue} total={data.profitAndLoss.totals.revenue} currency={data.currency} />
            <AccountTable title="Expenses" rows={data.profitAndLoss.expenses} total={data.profitAndLoss.totals.expenses} currency={data.currency} />
          </div>

          <section className="panel table-wrap">
            <div className="form-title-row"><h3>Balance Sheet</h3><Status ok={data.balanceSheet.totals.balanced} good="EQUATION BALANCED" bad="REVIEW DIFFERENCE" /></div>
            <table className="data-table"><tbody>
              <tr><th>Assets</th><td>{money(data.balanceSheet.totals.assets, data.currency)}</td></tr>
              <tr><th>Liabilities</th><td>{money(data.balanceSheet.totals.liabilities, data.currency)}</td></tr>
              <tr><th>Equity</th><td>{money(data.balanceSheet.totals.equity, data.currency)}</td></tr>
              <tr><th>Cumulative Current Earnings</th><td>{money(data.balanceSheet.totals.currentEarnings, data.currency)}</td></tr>
              <tr><th>Accounting Equation Difference</th><td><strong>{money(data.balanceSheet.totals.difference, data.currency)}</strong></td></tr>
            </tbody></table>
          </section>
          <div className="three-col">
            <AccountTable title="Assets" rows={data.balanceSheet.assets} total={data.balanceSheet.totals.assets} currency={data.currency} />
            <AccountTable title="Liabilities" rows={data.balanceSheet.liabilities} total={data.balanceSheet.totals.liabilities} currency={data.currency} />
            <AccountTable title="Equity" rows={data.balanceSheet.equity} total={data.balanceSheet.totals.equity} currency={data.currency} />
          </div>

          {(["receivables", "payables"] as const).map((kind) => {
            const aging = data.aging[kind];
            const receivable = kind === "receivables";
            return <section className="panel table-wrap" key={kind}>
              <div className="form-title-row"><h3>{receivable ? "Accounts Receivable" : "Accounts Payable"} Aging</h3><strong>{money(aging.total, data.currency)}</strong></div>
              <table className="data-table"><thead><tr>{BUCKETS.map((bucket) => <th key={bucket}>{bucket}</th>)}</tr></thead><tbody><tr>{BUCKETS.map((bucket) => <td key={bucket}>{money(aging.buckets[bucket], data.currency)}</td>)}</tr></tbody></table>
              <table className="data-table"><thead><tr><th>Document</th><th>{receivable ? "Customer" : "Supplier"}</th><th>Due</th><th>Days</th><th>Bucket</th><th>Outstanding</th></tr></thead><tbody>
                {aging.rows.map((row) => <tr key={row.id}><td><Link href={`/transactions/${receivable ? "invoice" : "supplierBill"}/${encodeURIComponent(row.id)}`}><strong>{row.code}</strong></Link></td><td>{row.partyCode} — {row.partyName}</td><td>{row.dueDate || "—"}</td><td>{row.overdueDays}</td><td>{row.bucket}</td><td>{money(row.outstanding, data.currency)}</td></tr>)}
                {!aging.rows.length && <tr><td colSpan={6}>No open posted documents.</td></tr>}
              </tbody></table>
            </section>;
          })}
        </>
      )}
    </>
  );
}
