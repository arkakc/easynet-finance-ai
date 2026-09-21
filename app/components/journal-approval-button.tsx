"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JournalApprovalButton({ journalId }: { journalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function approve() {
    if (busy) return;
    setBusy(true);
    setMessage("Approving…");
    try {
      const response = await fetch("/api/journals/manual/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId, decision: "APPROVE", note: "Approved from Journal Entry full view" }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Journal approval failed");
      setMessage("Approved successfully.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Journal approval failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="button-row">
      <button type="button" onClick={approve} disabled={busy}>{busy ? "Approving…" : "Approve"}</button>
      {message ? <span className="small">{message}</span> : null}
    </div>
  );
}
