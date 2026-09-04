"use client";

import { FormEvent, useState } from "react";

export default function JournalReversalPage() {
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/journals/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, payload: Object.fromEntries(form.entries()) }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Reversal failed");
      setMessage(JSON.stringify(body, null, 2));
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reversal failed");
    }
  }

  return (
    <>
      <h2>Journal Reversal</h2>
      <p className="small">Posted journals remain immutable. Corrections start with a full reversing journal; the corrected source transaction is then entered and posted separately.</p>
      <section className="panel warning-panel"><strong>Control:</strong> Never use this to hide or delete a genuine transaction. The reversal remains permanently linked to the original journal.</section>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <pre className="panel status-pre">{message}</pre>}

      <form className="panel form-grid" onSubmit={submit}>
        <h3 className="form-title">Reverse Posted Journal</h3>
        <label>Original Journal ID<input name="journalId" required placeholder="JRN-..." /></label>
        <label>Reversal Date<input name="reversalDate" type="date" required /></label>
        <label className="form-wide">Reason<textarea name="reason" rows={3} required placeholder="Explain the error and correction reason" /></label>
        <div className="form-wide"><button type="submit">Create Reversal Journal</button></div>
      </form>
    </>
  );
}
