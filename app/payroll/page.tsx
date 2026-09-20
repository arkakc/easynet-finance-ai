"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Employee = { id: string; code: string; name: string; department: string | null; position: string | null; baseSalary: number | string; payFrequency: string; superFundName: string | null };
type PayrollRun = { id: string; code: string; periodStart: string; periodEnd: string; paymentDate: string; status: string; totalGross: number | string; totalNet: number | string; totalEmployerSuper: number | string; journalId: string | null; createdBy: string };
type UnregisteredPayrollJournal = { id: string; code: string; date: string; reference: string; totalDebit: number; totalCredit: number };
type Payload = { success: boolean; error?: string; employees?: Employee[]; data?: PayrollRun[]; unregisteredPayrollJournals?: UnregisteredPayrollJournal[] };

const amount = (value: number | string | null | undefined) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK" }).format(Number(value || 0));
const dateOnly = (value: string) => value.slice(0, 10);

export default function PayrollPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/payroll/runs", { cache: "no-store" });
      const body = await response.json();
      setPayload(body);
      if (!response.ok) setNotice(body.error || "Could not load payroll control centre");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load payroll control centre");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const phrase = useMemo(() => periodStart && periodEnd ? `PROCESS PAYROLL ${periodStart} TO ${periodEnd}` : "", [periodStart, periodEnd]);
  const submit = async () => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/payroll/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodStart, periodEnd, paymentDate, notes, confirmation }) });
      const body = await response.json();
      setNotice(body.success ? `Payroll ${body.data?.code || "run"} processed and posted to the GL.` : body.error || "Payroll request failed");
      if (response.ok) { setConfirmation(""); setNotes(""); await load(); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Payroll request failed"); }
    finally { setBusy(false); }
  };

  const employees = payload?.employees || [];
  const runs = payload?.data || [];
  const unregistered = payload?.unregisteredPayrollJournals || [];
  return (
    <div className="page-stack">
      <section className="page-header"><div><span className="badge">PNG payroll control</span><h1>Payroll Control Centre</h1><p>Review active employees, confirm a pay period, and post one auditable payroll journal using PNG SWT and superannuation rules.</p></div></section>
      {notice && <section className={payload?.error || notice.includes("failed") || notice.includes("locked") || notice.includes("No active") ? "warning-panel" : "panel"}><strong>{notice}</strong></section>}
      <section className="panel">
        <div className="form-title-row"><div><h2>Payroll run authorisation</h2><p className="small">Posting requires <strong>post.approve</strong>. Duplicate periods, closed posting dates and missing employees are blocked.</p></div><span className="auto-badge">PNG · KINA</span></div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>Period start<input type="date" value={periodStart} disabled={busy} onChange={(event) => { setPeriodStart(event.target.value); setConfirmation(""); }} /></label>
          <label>Period end<input type="date" value={periodEnd} disabled={busy} onChange={(event) => { setPeriodEnd(event.target.value); setConfirmation(""); }} /></label>
          <label>Payment date<input type="date" value={paymentDate} disabled={busy} onChange={(event) => setPaymentDate(event.target.value)} /></label>
          <label className="form-wide">Notes (optional)<input value={notes} maxLength={500} disabled={busy} onChange={(event) => setNotes(event.target.value)} placeholder="Pay cycle or approval reference" /></label>
          <label className="form-wide">Confirmation <span className="small">Type exactly: {phrase || "PROCESS PAYROLL YYYY-MM-DD TO YYYY-MM-DD"}</span><input value={confirmation} disabled={busy || !phrase} onChange={(event) => setConfirmation(event.target.value)} placeholder={phrase || "Enter period dates first"} /></label>
          <div className="form-wide button-row"><button type="button" disabled={busy || !periodStart || !periodEnd || !paymentDate || !phrase || confirmation !== phrase} onClick={() => void submit()}>{busy ? "Processing…" : "Process and post payroll"}</button></div>
        </div>
      </section>
      <section className="panel">
        <div className="form-title-row"><div><h2>Active employee register</h2><p className="small">Payroll only includes employees currently marked active.</p></div><span className={`coa-status-pill ${employees.length ? "valid" : "invalid"}`}>{employees.length} active</span></div>
        <div className="table-wrap" style={{ marginTop: 16 }}><table className="data-table"><thead><tr><th>Code</th><th>Employee</th><th>Department / role</th><th>Base salary</th><th>Pay frequency</th><th>Super fund</th></tr></thead><tbody>{!employees.length && <tr><td colSpan={6}>No active employees are configured. Add employee master data before processing a live run.</td></tr>}{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.code}</strong></td><td>{employee.name}</td><td>{employee.department || "—"}<div className="small">{employee.position || "—"}</div></td><td>{amount(employee.baseSalary)}</td><td>{employee.payFrequency}</td><td>{employee.superFundName || "Nasfund"}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel">
        <div className="form-title-row"><div><h2>Posted payroll register</h2><p className="small">Each run creates one balanced journal and remains visible for month-end review.</p></div><span className="auto-badge">{runs.length} runs</span></div>
        <div className="table-wrap" style={{ marginTop: 16 }}><table className="data-table"><thead><tr><th>Run</th><th>Period</th><th>Payment</th><th>Status</th><th>Gross / net</th><th>Journal</th></tr></thead><tbody>{!runs.length && <tr><td colSpan={6}>No payroll runs have been posted.</td></tr>}{runs.map((run) => <tr key={run.id}><td><strong>{run.code}</strong><div className="small">{run.createdBy}</div></td><td>{dateOnly(run.periodStart)} – {dateOnly(run.periodEnd)}</td><td>{dateOnly(run.paymentDate)}</td><td><span className={`coa-status-pill ${run.status === "APPROVED" ? "valid" : "invalid"}`}>{run.status}</span></td><td>{amount(run.totalGross)}<div className="small">Net {amount(run.totalNet)} · Super {amount(run.totalEmployerSuper)}</div></td><td>{run.journalId || "—"}</td></tr>)}</tbody></table></div>
      </section>
      {unregistered.length > 0 && <section className="warning-panel"><strong>GL/register reconciliation required</strong><p className="small">{unregistered.length} posted payroll journal{unregistered.length === 1 ? " is" : "s are"} not linked to a PayrollRun register. Do not repost or reverse it automatically; identify the historical source and attach a controlled migration note.</p><div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table"><thead><tr><th>Journal</th><th>Date</th><th>Reference</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{unregistered.map((journal) => <tr key={journal.id}><td><strong>{journal.code}</strong></td><td>{dateOnly(journal.date)}</td><td>{journal.reference || "—"}</td><td>{amount(journal.totalDebit)}</td><td>{amount(journal.totalCredit)}</td></tr>)}</tbody></table></div></section>}
      <section className="warning-panel"><strong>PNG payroll controls</strong><p className="small">Calculations use the statutory PNG salary and wages tax bands and the configured employer superannuation rate. Before a real run, verify employee master data, approvals, bank funding and the posting-lock date.</p></section>
    </div>
  );
}
