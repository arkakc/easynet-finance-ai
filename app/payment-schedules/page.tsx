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

  const totalScheduled = schedules.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Payment Milestone Schedules</h2>
          <p className="small">Contract milestone management, percentage payment terms, and project cashflow planning.</p>
        </div>
        <div className="page-head-actions">
          {message && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Schedule notice:</strong> {message}
              </div>
            </details>
          )}
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh Schedules
          </button>
          <span className="badge">Milestone Billing</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Scheduled Milestones</div>
          <div className="value">{schedules.length}</div>
        </div>
        <div className="card">
          <div className="label">Total Scheduled Amount</div>
          <div className="value">K{totalScheduled.toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="label">Reference Quotes</div>
          <div className="value">{quotes.length}</div>
        </div>
        <div className="card">
          <div className="label">Reference Invoices</div>
          <div className="value">{invoices.length}</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={submit}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Register New Milestone</h3>
          <span className="auto-badge">Billing Schedule</span>
        </div>
        <label>
          Source Type
          <select name="sourceType" defaultValue="QUOTE">
            <option>QUOTE</option>
            <option>INVOICE</option>
            <option>PROJECT</option>
          </select>
        </label>
        <label>
          Source ID
          <input name="sourceId" required placeholder="Quote, Invoice or Project ID" />
        </label>
        <label>
          Project
          <select name="projectId" defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName} ({p.projectId})
              </option>
            ))}
          </select>
        </label>
        <label>
          Party ID
          <input name="partyId" placeholder="Customer or Supplier ID" />
        </label>
        <label>
          Milestone
          <input name="milestone" required placeholder="e.g. 30% Advance Deposit" />
        </label>
        <label>
          Due Date
          <input name="dueDate" type="date" />
        </label>
        <label>
          Percentage (%)
          <input name="percentage" type="number" min="0" max="100" step="0.01" required />
        </label>
        <label>
          Amount (PGK)
          <input name="amount" type="number" min="0" step="0.01" required />
        </label>
        <div className="form-wide button-row">
          <button type="submit">Save Milestone</button>
        </div>
      </form>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>Milestone Register</h3>
          <span className="auto-badge">{schedules.length} Milestones</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Source</th>
              <th>Project</th>
              <th>Party</th>
              <th>Milestone</th>
              <th>Due Date</th>
              <th>%</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((row) => (
              <tr key={row.scheduleId}>
                <td>
                  <strong>{row.scheduleId}</strong>
                </td>
                <td>
                  {row.sourceType} {row.sourceId}
                </td>
                <td>{row.projectId || "—"}</td>
                <td>{row.partyId || "—"}</td>
                <td>{row.milestone}</td>
                <td>{row.dueDate || "—"}</td>
                <td>{Number(row.percentage || 0).toFixed(2)}%</td>
                <td>K{Number(row.amount || 0).toFixed(2)}</td>
                <td>
                  <span className="auto-badge">{row.status}</span>
                </td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td colSpan={9}>Loading live payment schedules…</td>
              </tr>
            )}
            {!loading && !schedules.length && (
              <tr>
                <td colSpan={9}>No payment schedules found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
