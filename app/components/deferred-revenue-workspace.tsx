"use client";

import { useEffect, useMemo, useState } from "react";

type Schedule = { scheduleId: string; invoiceId: string; dueDate: string | null; amount: number; status: string; milestone: string };
type Result = { scheduleId: string; ok: boolean; journalId?: string; error?: string };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Port_Moresby" });
const formatMoney = (value: number) => "K" + Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DeferredRevenueWorkspace() {
  const [asOf, setAsOf] = useState(today);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  async function load(date = asOf) {
    setBusy(true);
    setMessage("");
    setLoaded(false);
    try {
      const response = await fetch("/api/accounting/deferred-revenue/due?asOf=" + encodeURIComponent(date), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load schedules");
      setSchedules(data.schedules || []);
      setSelected([]);
      setResults([]);
      setLoaded(true);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load schedules"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(today()); }, []);
  const shown = useMemo(() => schedules.filter(s => [s.scheduleId, s.invoiceId, s.milestone].some(v => v.toLowerCase().includes(search.toLowerCase().trim()))), [schedules, search]);
  const amount = useMemo(() => schedules.reduce((sum, s) => sum + Number(s.amount || 0), 0), [schedules]);
  const allShownSelected = shown.length > 0 && shown.every(s => selected.includes(s.scheduleId));
  async function postSelected() {
    if (busy || !selected.length) return;
    if (!window.confirm("Post " + selected.length + " due revenue recognition journal(s)? This creates financial GL entries and cannot be undone by editing schedules.")) return;
    setBusy(true); setMessage(""); setResults([]);
    try {
      const posted: Result[] = [];
      for (const scheduleId of selected) {
        const response = await fetch("/api/accounting/deferred-revenue", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduleId, action: "recognize", postingDate: asOf }),
        });
        const data = await response.json();
        posted.push({ scheduleId, ok: response.ok && data.ok, journalId: data.journalId, error: data.error });
      }
      setResults(posted);
      setMessage(posted.filter(r => r.ok).length + " posted, " + posted.filter(r => !r.ok).length + " failed. Review results below.");
      const response = await fetch("/api/accounting/deferred-revenue/due?asOf=" + encodeURIComponent(asOf), { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.ok) {
        setSchedules(data.schedules || []);
        setSelected([]);
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Posting failed"); }
    finally { setBusy(false); }
  }
  return <div>
    <div className="page-head"><div><h2>Deferred Revenue Recognition</h2><p className="small">Review due service revenue before posting controlled general ledger entries.</p></div><span className="badge">FINANCE APPROVAL</span></div>
    <div className="grid">
      <div className="card"><div className="label">Due Schedules</div><div className="value">{schedules.length}</div></div>
      <div className="card"><div className="label">Due Net Revenue</div><div className="value">{formatMoney(amount)}</div></div>
      <div className="card"><div className="label">Selected for Recognition</div><div className="value">{selected.length}</div></div>
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="form-title-row"><div><h3>Due Recognition Register</h3><p className="small">Only pending periods due on or before the as-of date. No journal is created by previewing.</p></div></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", margin: "16px 0" }}>
        <label style={{ flex: "0 0 180px" }}>As-of Date<input type="date" value={asOf} max={today()} onChange={e => { setAsOf(e.target.value); setLoaded(false); setSelected([]); }} /></label>
        <button type="button" className="secondary" disabled={busy || !asOf} onClick={() => void load()}>{busy ? "Working…" : "Refresh Preview"}</button>
        <input aria-label="Search due schedules" placeholder="Search invoice or schedule" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: "1 1 220px", minWidth: 180 }} />
      </div>
      <p className="small">Recognition is manually approved, not automatic. Maximum 25 selected schedules per posting run. GST is excluded from the schedule.</p>
      <div className="table-wrap">
        <table className="data-table"><thead><tr><th><input aria-label="Select all shown" type="checkbox" checked={allShownSelected} disabled={!loaded || busy} onChange={e => setSelected(prev => e.target.checked ? [...new Set([...prev, ...shown.map(s => s.scheduleId)])].slice(0, 25) : prev.filter(id => !shown.some(s => s.scheduleId === id)))} /></th><th>Schedule</th><th>Invoice</th><th>Due Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>
          {!shown.length && <tr><td colSpan={6}>{busy ? "Loading…" : "No due schedules for the selected filters."}</td></tr>}
          {shown.map(s => <tr key={s.scheduleId}><td><input type="checkbox" aria-label={"Select " + s.scheduleId} checked={selected.includes(s.scheduleId)} disabled={!loaded || busy || (!selected.includes(s.scheduleId) && selected.length >= 25)} onChange={e => setSelected(prev => e.target.checked ? [...prev, s.scheduleId].slice(0, 25) : prev.filter(id => id !== s.scheduleId))} /></td><td><strong>{s.scheduleId}</strong></td><td>{s.invoiceId}</td><td>{s.dueDate || "—"}</td><td>{formatMoney(s.amount)}</td><td>{s.status}</td></tr>)}
        </tbody></table>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 16 }}>
        <span className="small">{selected.length} selected</span>
        <button type="button" disabled={!loaded || busy || !selected.length} onClick={() => void postSelected()}>{busy ? "Processing…" : "Post Selected Recognition"}</button>
      </div>
      {message && <p role="status" style={{ marginTop: 14 }}>{message}</p>}
      {results.length > 0 && <div style={{ marginTop: 16 }}><h4>Posting Results</h4><div className="table-wrap"><table className="data-table"><thead><tr><th>Schedule</th><th>Result</th><th>Journal / Reason</th></tr></thead><tbody>{results.map(r => <tr key={r.scheduleId}><td>{r.scheduleId}</td><td>{r.ok ? "POSTED" : "FAILED"}</td><td>{r.ok ? r.journalId : r.error}</td></tr>)}</tbody></table></div></div>}
    </section>
  </div>;
}
