"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoanActionsPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(action: "accrue" | "repay", payload: Record<string, FormDataEntryValue>) {
    setBusy(true);
    try {
      const r = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "loanActions", body: { action, payload } }),
      });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error || "Loan action failed");
      setMessage(`${action === "accrue" ? "Interest accrual" : "Loan repayment"} posted successfully. Journal ${b.result?.journalId || b.result?.id || "posted"}.`);
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Loan action failed");
    } finally {
      setBusy(false);
    }
  }

  async function accrue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await call("accrue", Object.fromEntries(new FormData(e.currentTarget).entries()));
  }

  async function repay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await call("repay", Object.fromEntries(new FormData(e.currentTarget).entries()));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Loan Ledger Operations & Service Actions</h2>
          <p className="small">Compound monthly interest accruals and principal/interest repayment postings.</p>
        </div>
        <div className="page-head-actions">
          {message && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Action notice:</strong> {message}
              </div>
            </details>
          )}
          <Link prefetch={false} className="button-link secondary-link" href="/loans">
            ← Loan Register
          </Link>
          <span className="badge">Debt Servicing</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Interest Engine</div>
          <div className="value small-value">Compound Monthly (PNG)</div>
        </div>
        <div className="card">
          <div className="label">GL Settlement</div>
          <div className="value small-value">Immediate Journal Post</div>
        </div>
        <div className="card">
          <div className="label">Settlement Accounts</div>
          <div className="value small-value">ACC-1110 / ACC-1120</div>
        </div>
        <div className="card">
          <div className="label">Audit Trail</div>
          <div className="value small-value">Linked Journal Headers</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={accrue}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Accrue Compound Monthly Interest</h3>
          <span className="auto-badge">Periodic Accrual</span>
        </div>
        <label>
          Loan ID
          <input name="loanId" required defaultValue="LOAN-2026-0001" disabled={busy} />
        </label>
        <label>
          Accrue Through Date
          <input name="asOf" type="date" required defaultValue={new Date().toISOString().split("T")[0]} disabled={busy} />
        </label>
        <div className="form-wide button-row">
          <button type="submit" disabled={busy}>
            {busy ? "Processing…" : "Post Interest Accrual"}
          </button>
        </div>
      </form>

      <form className="panel form-grid" onSubmit={repay}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Post Loan Repayment</h3>
          <span className="auto-badge">Payment Entry</span>
        </div>
        <label>
          Loan ID
          <input name="loanId" required defaultValue="LOAN-2026-0001" disabled={busy} />
        </label>
        <label>
          Payment Date
          <input name="paymentDate" type="date" required defaultValue={new Date().toISOString().split("T")[0]} disabled={busy} />
        </label>
        <label>
          Principal Amount (PGK)
          <input name="principalAmount" type="number" min="0" step="0.01" defaultValue="0.00" disabled={busy} />
        </label>
        <label>
          Interest Amount (PGK)
          <input name="interestAmount" type="number" min="0" step="0.01" defaultValue="0.00" disabled={busy} />
        </label>
        <label>
          Cash / Bank Account
          <input name="cashBankAccountId" required defaultValue="ACC-1110" disabled={busy} />
        </label>
        <label>
          Payment Method
          <select name="paymentMethod" disabled={busy}>
            <option>Bank Transfer</option>
            <option>Cash</option>
            <option>Cheque</option>
          </select>
        </label>
        <label className="form-wide">
          Payment Reference
          <input name="reference" placeholder="e.g. BSP Ref 982341" disabled={busy} />
        </label>
        <div className="form-wide button-row">
          <button type="submit" disabled={busy}>
            {busy ? "Processing…" : "Post Loan Repayment"}
          </button>
        </div>
      </form>
    </>
  );
}
