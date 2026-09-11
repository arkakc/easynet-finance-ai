"use client";

import { FormEvent, useEffect, useState } from "react";

type Budget = {
  budgetId: string;
  financialYear: string;
  period: string;
  accountId: string;
  projectId: string;
  budgetAmount: number | string;
  actualAmount: number | string;
  variance: number | string;
};

type Account = {
  accountId: string;
  accountCode: string;
  accountName: string;
};

type Project = {
  projectId: string;
  projectName: string;
};

const money = (v: unknown) => `K${Number(v || 0).toFixed(2)}`;

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [b, m] = await Promise.all([
        fetch("/api/budgets").then((r) => r.json()),
        fetch("/api/masters").then((r) => r.json()),
      ]);
      if (!b.ok) throw new Error(b.error || "Budget load failed");
      if (!m.ok) throw new Error(m.error || "Project load failed");
      setBudgets(b.budgets || []);
      setAccounts(b.accounts || []);
      setProjects(m.projects || []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "budgets", body: { record: Object.fromEntries(form.entries()) } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Budget save failed");
      setMessage(`Budget ${body.row.budgetId} created.`);
      event.currentTarget.reset();
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Budget save failed");
    }
  }

  const totalBudget = budgets.reduce((sum, b) => sum + Number(b.budgetAmount || 0), 0);
  const totalActual = budgets.reduce((sum, b) => sum + Number(b.actualAmount || 0), 0);
  const totalVariance = totalBudget - totalActual;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Budget vs Actual Performance</h2>
          <p className="small">Variance analysis, period utilisation controls, and financial year allocation tracking.</p>
        </div>
        <div className="page-head-actions">
          {message && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Budget status:</strong> {message}
              </div>
            </details>
          )}
          <span className="badge">Budget Controls</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Active Budgets</div>
          <div className="value">{budgets.length}</div>
        </div>
        <div className="card">
          <div className="label">Total Budget Amount</div>
          <div className="value">{money(totalBudget)}</div>
        </div>
        <div className="card">
          <div className="label">Total Actual Spend</div>
          <div className="value">{money(totalActual)}</div>
        </div>
        <div className="card">
          <div className="label">Net Variance</div>
          <div className="value">{money(totalVariance)}</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={submit}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Create Budget Allocation</h3>
          <span className="auto-badge">Financial Planning</span>
        </div>
        <label>
          Budget ID
          <input name="budgetId" placeholder="Optional auto ID" />
        </label>
        <label>
          Financial Year
          <input name="financialYear" defaultValue={new Date().getFullYear()} required />
        </label>
        <label>
          Period
          <input name="period" defaultValue="ANNUAL" required />
        </label>
        <label>
          Account
          <select name="accountId" required defaultValue="">
            <option value="" disabled>
              Select account
            </option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.accountCode} — {a.accountName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select name="projectId" defaultValue="">
            <option value="">Company-wide</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName} ({p.projectId})
              </option>
            ))}
          </select>
        </label>
        <label>
          Budget Amount (PGK)
          <input name="budgetAmount" type="number" min="0" step="0.01" required />
        </label>
        <div className="form-wide button-row">
          <button type="submit">Create Budget</button>
        </div>
      </form>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>Budget Tracking Register</h3>
          <span className="auto-badge">{budgets.length} Allocations</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Budget ID</th>
              <th>FY</th>
              <th>Period</th>
              <th>Account</th>
              <th>Project</th>
              <th>Budget Amount</th>
              <th>Actual Spend</th>
              <th>Variance</th>
              <th>Utilisation</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((row) => {
              const budget = Number(row.budgetAmount || 0);
              const actual = Number(row.actualAmount || 0);
              const utilisation = budget ? (actual / budget) * 100 : 0;
              return (
                <tr key={row.budgetId}>
                  <td>
                    <strong>{row.budgetId}</strong>
                  </td>
                  <td>{row.financialYear}</td>
                  <td>{row.period}</td>
                  <td>{row.accountId}</td>
                  <td>{row.projectId || "—"}</td>
                  <td>{money(budget)}</td>
                  <td>{money(actual)}</td>
                  <td>
                    <strong style={{ color: Number(row.variance || 0) < 0 ? "#dc2626" : "inherit" }}>
                      {money(row.variance)}
                    </strong>
                  </td>
                  <td>
                    <span className="auto-badge">{utilisation.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
            {!budgets.length && (
              <tr>
                <td colSpan={9}>No budgets created yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
