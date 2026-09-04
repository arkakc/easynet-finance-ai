"use client";

import { FormEvent, useEffect, useState } from "react";

export default function PaymentSchedulesPage() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [s, t, m] = await Promise.all([
        fetch("/api/payment-schedules", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/transactions", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/masters", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!s.ok) throw new Error(s.error || "Schedule load failed");
      if (!t.ok) throw new Error(t.error || "Transaction load failed");
      if (!m.ok) throw new Error(m.error || "Master-data load failed");
      setSchedules(s.schedules || []);
      setQuotes(t.quotes || []);
      setInvoices(t.invoices || []);
      setProjects(m.projects || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/payment-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, record: Object.fromEntries(form.entries()) }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Schedule save failed");
      setMessage(`Milestone saved. Total scheduled: ${Number(body.totalPercentage).toFixed(2)}%.`);
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schedule save failed");
    }
  }

  return (
    <>
      <h2>Payment Schedules</h2>
      <p className="small">Track contract milestones such as 40% advance, 40% after installation and 20% on handover.</p>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <form className="panel form-grid" onSubmit={submit}>
        <h3 className="form-title">New Milestone</h3>
        <label>Source Type<select name="sourceType" defaultValue="QUOTE"><option>QUOTE</option><option>INVOICE</option><option>PROJECT</option></select></label>
        <label>Source ID<input name="sourceId" required placeholder="QT... / INV... / PJ..." /></label>
        <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName} ({p.projectId})</option>)}</select></label>
        <label>Party ID<input name="partyId" placeholder="Customer ID" /></label>
        <label>Milestone<input name="milestone" required placeholder="40% Advance" /></label>
        <label>Due Date<input name="dueDate" type="date" /></label>
        <label>Percentage<input name="percentage" type="number" min="0" max="100" step="0.01" required /></label>
        <label>Amount<input name="amount" type="number" min="0" step="0.01" required /></label>
        <div className="form-wide"><button type="submit">Save Milestone</button></div>
      </form>

      <section className="panel table-wrap">
        <h3>Milestone Register</h3>
        <table className="data-table"><thead><tr><th>Schedule</th><th>Source</th><th>Project</th><th>Party</th><th>Milestone</th><th>Due</th><th>%</th><th>Amount</th><th>Status</th></tr></thead><tbody>
          {schedules.map((row) => <tr key={row.scheduleId}><td>{row.scheduleId}</td><td>{row.sourceType} {row.sourceId}</td><td>{row.projectId || "—"}</td><td>{row.partyId || "—"}</td><td>{row.milestone}</td><td>{row.dueDate || "—"}</td><td>{Number(row.percentage || 0).toFixed(2)}%</td><td>K{Number(row.amount || 0).toFixed(2)}</td><td>{row.status}</td></tr>)}
          {!schedules.length && <tr><td colSpan={9}>No payment schedules found.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel">
        <h3>Reference Documents</h3>
        <p className="small">Open quotations: {quotes.length} · Invoices: {invoices.length} · Projects: {projects.length}</p>
      </section>
    </>
  );
}
