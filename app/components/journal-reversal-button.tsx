"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const todayPNG = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby" }).format(new Date());

export default function JournalReversalButton({ journalId }: { journalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reversalDate, setReversalDate] = useState(todayPNG);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function close() {
    if (busy) return;
    setOpen(false);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!reversalDate) return setError("Reversal date is required.");
    if (reason.trim().length < 5) return setError("Please enter a reversal reason of at least 5 characters.");

    setBusy(true);
    try {
      const response = await fetch("/api/journals/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId, reversalDate, reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Journal reversal failed");
      setOpen(false);
      router.push(`/journals/${body.reversalJournalId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journal reversal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)} disabled={busy}>
        Reverse Journal
      </button>

      {open ? (
        <div className="finance-modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <form className="finance-modal-container" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="journal-reversal-title">
            <div className="finance-modal-header">
              <div className="finance-modal-header-title">
                <div>
                  <h3 id="journal-reversal-title">Reverse Journal</h3>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{journalId}</div>
                </div>
              </div>
              <button type="button" className="finance-modal-close-btn" onClick={close} aria-label="Close">×</button>
            </div>

            <div className="finance-modal-body">
              <div className="settings-info-banner">
                This posts an equal and opposite journal. The original posted journal remains unchanged for audit history.
              </div>

              <div className="finance-modal-field">
                <label htmlFor="reversal-date">Reversal Date</label>
                <input id="reversal-date" className="finance-modal-input" type="date" value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} required />
              </div>

              <div className="finance-modal-field">
                <label htmlFor="reversal-reason">Reason for Reversal</label>
                <textarea id="reversal-reason" className="finance-modal-input" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this posted journal is being reversed" required />
              </div>

              {error ? <div className="settings-blocked-banner">{error}</div> : null}
            </div>

            <div className="finance-modal-footer">
              <button type="button" className="btn" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" className="danger-delete-btn" disabled={busy || !reversalDate || reason.trim().length < 5}>
                {busy ? "Reversing and Posting…" : "Reverse and Post"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
