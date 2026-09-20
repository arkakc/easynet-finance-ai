"use client";

import { useCallback, useEffect, useState } from "react";

type Check = { key: string; label: string; severity: "PASS" | "WARNING" | "BLOCKING"; count: number; message: string };
type Checklist = { month: string; periodStart: string; periodEnd: string; ready: boolean; blockingCount: number; warningCount: number; checks: Check[]; totals: { postedJournals: number; totalDebit: number; totalCredit: number; difference: number } };
type Period = { id: string; code: string; name: string; status: "OPEN" | "CLOSED"; startDate: string; endDate: string; closedBy: string | null; closedAt: string | null; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null };
type ResponseData = { ok: boolean; error?: string; canReopen?: boolean; postingLockDate?: string; checklist?: Checklist | null; periods?: Period[] };

function previousPngMonth() {
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit" }).format(new Date());
  const [year, month] = current.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function PeriodClosePage() {
  const [month, setMonth] = useState(previousPngMonth);
  const [data, setData] = useState<ResponseData | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/accounting/period-close?month=${encodeURIComponent(month)}`, { cache: "no-store" });
    const body = await response.json();
    setData(body);
    if (!response.ok) setNotice(body.error || "Could not load period controls");
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (action: "close" | "reopen") => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/accounting/period-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, month, confirmation, reason }) });
      const body = await response.json();
      setNotice(body.message || body.error || "Period action completed");
      if (response.ok) { setConfirmation(""); setReason(""); await load(); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Period action failed"); }
    finally { setBusy(false); }
  };

  const selected = data?.periods?.find((period) => period.code === month);
  const closePhrase = `CLOSE ${month}`;
  const reopenPhrase = `REOPEN ${month}`;
  return (
    <div className="page-stack">
      <section className="page-header"><div><span className="badge">Financial control</span><h1>Month-End Close Centre</h1><p>Complete control checks before locking a Papua New Guinea accounting period against further posting.</p></div><label>Accounting month<input type="month" value={month} required disabled={busy} onChange={(event) => { setMonth(event.target.value); setConfirmation(""); setNotice(""); }} /></label></section>
      {notice && <section className="panel"><strong>{notice}</strong></section>}
      <section className="panel">
        <div className="form-title-row"><div><h2>Close readiness</h2><p className="small">Posting lock currently applies through <strong>{data?.postingLockDate || "no closed date"}</strong>.</p></div><span className={`coa-status-pill ${data?.checklist?.ready ? "valid" : "invalid"}`}>{data?.checklist?.ready ? "READY TO CLOSE" : `${data?.checklist?.blockingCount ?? "—"} BLOCKING`}</span></div>
        {data?.checklist && <div className="document-meta" style={{ marginTop: 16 }}><div><span>Period</span><strong>{data.checklist.periodStart} – {data.checklist.periodEnd}</strong></div><div><span>Posted journals</span><strong>{data.checklist.totals.postedJournals}</strong></div><div><span>Total debit</span><strong>K{data.checklist.totals.totalDebit.toFixed(2)}</strong></div><div><span>Total credit</span><strong>K{data.checklist.totals.totalCredit.toFixed(2)}</strong></div></div>}
      </section>
      <section className="panel table-wrap">
        <table className="data-table"><thead><tr><th>Control</th><th>Status</th><th>Result</th></tr></thead><tbody>{data?.checklist?.checks.map((row) => <tr key={row.key}><td><strong>{row.label}</strong></td><td><span className={`coa-status-pill ${row.severity === "PASS" ? "valid" : "invalid"}`}>{row.severity}</span></td><td>{row.message}</td></tr>) || <tr><td colSpan={3}>Loading close controls…</td></tr>}</tbody></table>
      </section>
      {selected?.status === "CLOSED" ? (
        <section className="panel"><h2>Controlled reopen</h2><p className="small">Only a System Manager may reopen the latest closed period. A business reason and audit entry are mandatory.</p><div className="form-grid" style={{ marginTop: 16 }}><label className="form-wide">Reason<input value={reason} required disabled={busy || !data?.canReopen} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this period must be reopened" /></label><label>Confirmation<input value={confirmation} required disabled={busy || !data?.canReopen} onChange={(event) => setConfirmation(event.target.value)} placeholder={reopenPhrase} /></label><div className="form-wide button-row"><button type="button" disabled={busy || !data?.canReopen || reason.trim().length < 10 || confirmation !== reopenPhrase} onClick={() => void submit("reopen")}>{busy ? "Reopening…" : "Reopen period"}</button></div></div></section>
      ) : (
        <section className="panel"><h2>Close and lock period</h2><p className="small">Warnings require review but do not block close. Every blocking control must pass. Type <strong>{closePhrase}</strong> to confirm.</p><div className="button-row" style={{ marginTop: 16 }}><input value={confirmation} required disabled={busy} onChange={(event) => setConfirmation(event.target.value)} placeholder={closePhrase} style={{ maxWidth: 320 }} /><button type="button" disabled={busy || !data?.checklist?.ready || confirmation !== closePhrase} onClick={() => void submit("close")}>{busy ? "Closing…" : "Close accounting period"}</button></div></section>
      )}
      <section className="panel table-wrap"><div className="form-title-row"><div><h2>Period register</h2><p className="small">Close and reopen decisions remain visible with actor and timestamp.</p></div><span className="auto-badge">{data?.periods?.length || 0} periods</span></div><table className="data-table" style={{ marginTop: 16 }}><thead><tr><th>Period</th><th>Status</th><th>Closed</th><th>Reopened</th></tr></thead><tbody>{!data?.periods?.length && <tr><td colSpan={4}>No periods have been closed.</td></tr>}{data?.periods?.map((period) => <tr key={period.id} onClick={() => setMonth(period.code)} style={{ cursor: "pointer" }}><td><strong>{period.name}</strong><br /><span className="small">{period.code}</span></td><td>{period.status}</td><td>{period.closedAt ? `${new Date(period.closedAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })} · ${period.closedBy}` : "—"}</td><td>{period.reopenedAt ? `${new Date(period.reopenedAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })} · ${period.reopenedBy}` : "—"}</td></tr>)}</tbody></table></section>
    </div>
  );
}
