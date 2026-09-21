"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JournalPreApprovalActions({ journalId }: { journalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function remove() {
    if (!window.confirm("Delete this unapproved journal? This cannot be undone.")) return;
    setBusy(true);
    setMessage("Deleting…");
    try {
      const response = await fetch(`/api/journals/manual?journalId=${encodeURIComponent(journalId)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Journal delete failed");
      router.push("/journals");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Journal delete failed");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="secondary" disabled={busy} onClick={() => router.push(`/manual-journal-entry?edit=${encodeURIComponent(journalId)}`)}>
        Edit
      </button>
      <button type="button" className="secondary" disabled={busy} onClick={remove}>
        {busy ? "Deleting…" : "Delete"}
      </button>
      {message ? <span className="small">{message}</span> : null}
    </>
  );
}
