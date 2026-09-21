"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function JournalReversalPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "journalReverse", body: { payload: Object.fromEntries(form.entries()) } }),
      });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error || "Reversal failed");
      setMessage(`Reversal journal ${b.reversalJournalId || b.id || "created"} successfully posted and linked.`);
      e.currentTarget.reset();
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Reversal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>General Ledger Journal Reversal</h2>
          <p className="small">
            Audit-safe reversal mechanism. Posted journals remain permanently immutable and linked to the counter-entry.
          </p>
        </div>
        <div className="page-head-actions">
          {message && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Reversal status:</strong> {message}
              </div>
            </details>
          )}
          <Link prefetch={false} className="button-link secondary-link" href="/journals">
            ← Posted Journals
          </Link>
          <span className="badge">Integrity Control</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Ledger Principle</div>
          <div className="value small-value">Permanent Immutability</div>
        </div>
        <div className="card">
          <div className="label">Traceability</div>
          <div className="value small-value">Cross-Linked Journals</div>
        </div>
        <div className="card">
          <div className="label">Authority Requirement</div>
          <div className="value small-value">Finance Approver</div>
        </div>
        <div className="card">
          <div className="label">Reporting Effect</div>
          <div className="value small-value">Immediate Balance Offset</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={submit}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Reverse Posted Journal</h3>
          <span className="auto-badge">Counter Balancing Entry</span>
        </div>
        <label>
          Original Journal ID
          <input name="journalId" required placeholder="e.g. JO-48291-2026" disabled={busy} />
        </label>
        <label>
          Reversal Date
          <input name="reversalDate" type="date" required defaultValue={new Date().toISOString().split("T")[0]} disabled={busy} />
        </label>
        <label className="form-wide">
          Audit Reason for Reversal
          <textarea name="reason" rows={3} required placeholder="Detailed explanation for financial audit logs" disabled={busy} />
        </label>
        <div className="form-wide button-row">
          <button type="submit" disabled={busy}>
            {busy ? "Posting Reversal…" : "Create & Post Reversal Journal"}
          </button>
        </div>
      </form>
    </>
  );
}
