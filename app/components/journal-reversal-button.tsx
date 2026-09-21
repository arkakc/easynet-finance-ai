"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JournalReversalButton({ journalId }: { journalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reverseJournal() {
    const reversalDate = window.prompt("Reversal date (YYYY-MM-DD):", new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby" }).format(new Date()));
    if (!reversalDate) return;
    const reason = window.prompt("Reason for reversal (minimum 5 characters):", "UAT journal reversal");
    if (!reason) return;
    if (!window.confirm(`Reverse journal ${journalId} and post the counter-entry?`)) return;

    setBusy(true);
    try {
      const response = await fetch("/api/journals/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId, reversalDate, reason }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Journal reversal failed");
      window.alert(`Reversal posted successfully: ${body.reversalJournalId}`);
      router.push(`/journals/${body.reversalJournalId}`);
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Journal reversal failed");
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="btn btn-danger" onClick={reverseJournal} disabled={busy}>{busy ? "Reversing…" : "Reverse Journal"}</button>;
}
