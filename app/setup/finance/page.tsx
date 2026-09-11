"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function FinanceSetupPage() {
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  async function runSetup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRunning(true);
    setResult("Verifying Chart of Accounts against statutory standards…");
    try {
      const r = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "setupFinance", body: {} }),
      });
      const b = await r.json();
      setResult(JSON.stringify(b, null, 2));
    } catch (x) {
      setResult(x instanceof Error ? x.message : "Setup request failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Finance Subsystem Initialization</h2>
          <p className="small">
            Structural audit and Chart of Accounts integrity verification. Configuration-only process without creating balance mutations.
          </p>
        </div>
        <div className="page-head-actions">
          {result && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown" style={{ maxHeight: "300px", overflowY: "auto", maxWidth: "450px" }}>
                <strong>Verification Results:</strong>
                <pre style={{ margin: "6px 0 0 0", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem" }}>
                  {result}
                </pre>
              </div>
            </details>
          )}
          <Link prefetch={false} className="button-link secondary-link" href="/settings">
            ← Finance Settings
          </Link>
          <span className="badge">System Admin</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Structure Status</div>
          <div className="value small-value">Standard COA Structure</div>
        </div>
        <div className="card">
          <div className="label">Initialization Scope</div>
          <div className="value small-value">Chart of Accounts Only</div>
        </div>
        <div className="card">
          <div className="label">Data Safety</div>
          <div className="value small-value">Zero Balance Mutation</div>
        </div>
        <div className="card">
          <div className="label">Authority Level</div>
          <div className="value small-value">System Manager</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={runSetup}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Chart of Accounts Verification</h3>
          <span className="auto-badge">Core Engine</span>
        </div>
        <p className="small form-wide">
          Click below to verify that all statutory accounts (Asset, Liability, Equity, Income, Expense) and control accounts (GRNI, Advances, GST) exist and match system requirements.
        </p>
        <div className="form-wide button-row">
          <button type="submit" disabled={running}>
            {running ? "Verifying Accounts…" : "Verify / Initialize Chart of Accounts"}
          </button>
        </div>
      </form>
    </>
  );
}
