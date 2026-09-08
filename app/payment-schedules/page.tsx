"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

export default function PaymentSchedulesPage() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [scheduleResponse, transactionResponse, masterResponse] = await Promise.all([
        fetch("/api/payment-schedules", { cache: "no-store", signal }),
        fetch("/api/erp/transaction-list?scope=salesModule", { cache: "no-store", signal }),
        fetch("/api/masters/scoped?scope=project", { cache: "no-store", signal }),
      ]);
      const [s, t, m] = await Promise.all([
        scheduleResponse.json(), transactionResponse.json(), masterResponse.json(),
      ]);
      if (!scheduleResponse.ok || !s.ok) throw new Error(s.error || "Schedule load failed");
      if (!transactionResponse.ok || !t.ok) throw new Error(t.error || "Transaction load failed");
      if (!masterResponse.ok || !m.ok) throw new Error(m.error || "Master-data load failed");
      setSchedules(s.schedules || []);
      setQuotes(t.quotes || []);
      setInvoices(t.invoices || []);
      setProjects(m.projects || []);
    } catch (error) {
      if (signal?.aborted) return;
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => { void load(controller.signal); });
    return () => { controller.abort(); window.cancelAnimationFrame(frame); };
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "paymentSchedules", body: { record: Object.fromEntries(form.entries()) } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Schedule save failed");
      setMessage(`Milestone saved. Total scheduled: ${Number(body.totalPercentage).toFixed(2)}%.`);
      formElement.reset();
      setLoading(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schedule save failed");
    }
  }

  return <>
    <h2>Payment Schedules</h2>
    <p className="small">UI loads first. Schedule and reference values are requested from scoped APIs after the first paint.</p>
    {message && <section className="panel"><strong>Status:</strong> {message}</section>}
    <form className="panel form-grid" onSubmit={submit}>
      <h3 className="form-title">New Milestone</h3>
      <label>Source Type<select name="sourceType" defaultValue="QUOTE"><option>QUOTE</option><option>INVOICE</option><option>PROJECT</option></select></label>
      <label>Source ID<input name="sourceId" required /></label>
      <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName} ({p.projectId})</option>)}</select></label>
      <label>Party ID<input name="partyId" /></label>
      <label>Milestone<input name="milestone" required /></label>
      <label>Due Date<input name="dueDate" type="date" /></label>
      <label>Percentage<input name="percentage" type="number" min="0" max="100" step="0.01" required /></label>
      <label>Amount<input name="amount" type="number" min="0" step="0.01" required /></label>
      <div className="form-wide"><button type="submit">Save Milestone</button></div>
    </form>
    <section className="panel table-wrap">
      <h3>Milestone Register</h3>
      <table className="data-table"><thead><tr><th>Schedule</th><th>Source</th><th>Project</th><th>Party</th><th>Milestone</th><th>Due</th><th>%</th><th>Amount</th><th>Status</th></tr></thead><tbody>
        {schedules.map(row => <tr key={row.scheduleId}><td>{row.scheduleId}</td><td>{row.sourceType} {row.sourceId}</td><td>{row.projectId || "—"}</td><td>{row.partyId || "—"}</td><td>{row.milestone}</td><td>{row.dueDate || "—"}</td><td>{Number(row.percentage || 0).toFixed(2)}%</td><td>K{Number(row.amount || 0).toFixed(2)}</td><td>{row.status}</td></tr>)}
        {loading && <tr><td colSpan={9}>Loading live payment schedules…</td></tr>}
        {!loading && !schedules.length && <tr><td colSpan={9}>No payment schedules found.</td></tr>}
      </tbody></table>
    </section>
    <section className="panel"><h3>Reference Documents</h3><p className="small">Sales Quotations: {quotes.length} · Sales Invoices: {invoices.length} · Projects: {projects.length}</p></section>
  </>;
}
