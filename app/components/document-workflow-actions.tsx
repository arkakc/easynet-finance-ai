"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RecordType = "quote" | "invoice" | "purchaseOrder" | "supplierBill" | "payment" | "expense";

export default function DocumentWorkflowActions({ recordType, recordId, status }: { recordType: RecordType; recordId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const current = String(status || "DRAFT").toUpperCase();

  async function approve() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "approvals",
          body: {
            payload: {
              recordType,
              recordId,
              decision: "APPROVE",
              note: "Document workflow",
            },
          },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval failed");
      setMessage("Document approved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  if (current !== "DRAFT") return null;

  return (
    <div className="no-print" style={{ marginTop: 16 }}>
      <div className="button-row">
        <button type="button" onClick={approve} disabled={busy}>
          {busy ? "Approving…" : "Approve"}
        </button>
      </div>
      {message && <div className="small" style={{ marginTop: 8 }}>{message}</div>}
    </div>
  );
}
