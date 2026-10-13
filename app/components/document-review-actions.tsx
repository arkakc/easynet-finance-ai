"use client";
import { useEffect, useState } from "react";

type State = { status: string; review: { id: string; status: string; requestedBy: string; rejectionReason: string | null } | null; canSubmit: boolean; canReview: boolean };
export default function DocumentReviewActions({ type, id, onChanged }: { type: string; id: string; onChanged: () => Promise<void> | void }) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/erp/document-review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error || "Workflow unavailable"); return json; })
      .then(json => { if (!controller.signal.aborted) { setData(json); setError(""); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Workflow unavailable"); });
    return () => controller.abort();
  }, [type, id, nonce]);
  async function action(decision: "SUBMIT" | "APPROVE" | "REJECT") {
    if (busy || (decision === "REJECT" && !note.trim())) return;
    if (decision !== "SUBMIT" && !window.confirm(`${decision.toLowerCase()} this submitted document?`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/erp/document-review", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, action: decision, note }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Workflow action failed");
      setNote(""); setNonce(n => n + 1); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Workflow action failed"); }
    finally { setBusy(false); }
  }
  const pending = data && ["PENDING", "IN_REVIEW"].includes(data.review?.status || "");
  return <section className="panel no-print phase3-document-panel" aria-label="Submit and review workflow" id="document-review">
    <h2>Document Review</h2>
    {!data && !error && <p className="small">Checking workflow…</p>}
    {error && <p role="alert" className="small">{error}</p>}
    {data && <>
      <p className="small">Document: <strong>{data.status}</strong> · Review: <strong>{data.review?.status || "NOT SUBMITTED"}</strong></p>
      {data.review?.rejectionReason && <p className="small">Rejection reason: {data.review.rejectionReason}</p>}
      {!pending && data.status === "DRAFT" && data.canSubmit &&
        <button type="button" disabled={busy} onClick={() => void action("SUBMIT")}>{busy ? "Processing…" : "Submit for Review"}</button>}
      {pending && data.canReview && <>
        <label htmlFor="document-review-note">Review note (required to reject)</label>
        <textarea id="document-review-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} />
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => void action("APPROVE")}>Approve & Process</button>
          <button type="button" disabled={busy || !note.trim()} onClick={() => void action("REJECT")}>Reject</button>
        </div>
      </>}
      {pending && !data.canReview && <p className="small">Awaiting an authorized reviewer. Makers cannot approve their own submissions.</p>}
    </>}
  </section>;
}
