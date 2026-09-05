"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type PaymentRecord = {
  paymentId: string;
  paymentNumber?: string;
  paymentDate?: string;
  amount?: number | string;
  paymentMethod?: string;
  cashBankAccountId?: string;
  reference?: string;
  againstDocumentType?: string;
  againstDocumentId?: string;
  partyType?: string;
  partyId?: string;
  projectId?: string;
  status?: string;
  journalId?: string;
};

export default function PaymentFinalSave({ record }: { record: PaymentRecord }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const finalized = Boolean(String(record.journalId || "").trim());
  const approved = String(record.status || "").toUpperCase() === "APPROVED";

  if (!approved) return null;

  async function finalSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (finalized) return;
    const confirmed = window.confirm("Are you sure you want to create/finalize this Payment Entry? This will create the accounting/payment effect.");
    if (!confirmed) {
      setMessage("Final Save cancelled. The form is still editable.");
      return;
    }

    setBusy(true);
    setMessage("Finalizing Payment Entry…");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/erp/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finalizePayment",
          payload: {
            paymentId: record.paymentId,
            partyType: record.partyType,
            paymentDate: form.get("paymentDate"),
            amount: form.get("amount"),
            paymentMethod: form.get("paymentMethod"),
            cashBankAccountId: form.get("cashBankAccountId"),
            reference: form.get("reference"),
          },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Final Save failed");
      setMessage("Payment Entry finalized successfully.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Final Save failed");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel no-print" style={{ marginTop: 20 }}>
    <div className="form-title-row">
      <div>
        <h3>{finalized ? "Payment Entry Finalized" : "Approved Payment Entry — Final Review"}</h3>
        <p className="small">Approval authorizes the payment. Review or edit the payment details below, then use Final Save to create the accounting/payment effect.</p>
      </div>
      <span className="auto-badge">{finalized ? "FINALIZED" : "APPROVED — EDITABLE"}</span>
    </div>

    <form className="form-grid" onSubmit={finalSave} style={{ marginTop: 18 }}>
      <label>Payment Entry No<input value={record.paymentNumber || record.paymentId} readOnly /></label>
      <label>Customer / Supplier<input value={record.partyId || ""} readOnly /></label>
      <label>Previous Document<input value={`${record.againstDocumentType || ""} ${record.againstDocumentId || ""}`.trim()} readOnly /></label>
      <label>Project<input value={record.projectId || ""} readOnly /></label>
      <label>Payment Date<input name="paymentDate" type="date" defaultValue={String(record.paymentDate || "").slice(0, 10)} required disabled={finalized || busy} /></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={Number(record.amount || 0)} required disabled={finalized || busy} /></label>
      <label>Payment Method<select name="paymentMethod" defaultValue={record.paymentMethod || ""} required disabled={finalized || busy}><option value="">Select method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue={record.cashBankAccountId || ""} placeholder="Select / enter cash or bank account" required disabled={finalized || busy} /></label>
      <label className="form-wide">Reference<input name="reference" defaultValue={record.reference || ""} placeholder="Bank reference / receipt reference" disabled={finalized || busy} /></label>
      {!finalized && <div className="form-wide"><button type="submit" disabled={busy}>{busy ? "Finalizing…" : "Final Save"}</button></div>}
    </form>
    {message && <div className="status-banner" style={{ marginTop: 14 }}>{message}</div>}
  </section>;
}
