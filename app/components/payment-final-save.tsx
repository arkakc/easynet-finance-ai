"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
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

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const eligibleStatus = (value: unknown) => ["POSTED", "PARTLY_PAID", "APPROVED"].includes(String(value || "").toUpperCase());

export default function PaymentFinalSave({ record }: { record: PaymentRecord }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const finalized = Boolean(String(record.journalId || "").trim());
  const approved = String(record.status || "").toUpperCase() === "APPROVED";
  const directAdvance = finalized && !String(record.againstDocumentId || "").trim();
  const customerAdvance = String(record.partyType || "") === "Customer";

  useEffect(() => {
    if (!directAdvance) return;
    let active = true;
    void (async () => {
      setLoadingDocs(true);
      try {
        const response = await fetch("/api/erp/transactions", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "Open documents load failed");
        const source = customerAdvance ? body.invoices || [] : body.supplierBills || [];
        const partyField = customerAdvance ? "customerId" : "supplierId";
        const rows = source.filter((row: any) => String(row[partyField] || "") === String(record.partyId || "")
          && eligibleStatus(row.status)
          && Number(row.outstandingAmount ?? row.totalAmount ?? 0) >= Number(record.amount || 0) - 0.001);
        if (active) setDocuments(rows);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Open documents load failed");
      } finally {
        if (active) setLoadingDocs(false);
      }
    })();
    return () => { active = false; };
  }, [directAdvance, customerAdvance, record.partyId, record.amount]);

  async function finalSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (finalized) return;
    const confirmed = window.confirm("Are you sure you want to finalize this Payment Entry? This will create the accounting effect.");
    if (!confirmed) { setMessage("Final Save cancelled. The form is still editable."); return; }

    setBusy(true); setMessage("Finalizing Payment Entry…");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/erp/transactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalizePayment", payload: {
          paymentId: record.paymentId, partyType: record.partyType, paymentDate: form.get("paymentDate"), amount: form.get("amount"),
          paymentMethod: form.get("paymentMethod"), cashBankAccountId: form.get("cashBankAccountId"), reference: form.get("reference"),
        } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Final Save failed");
      setMessage(body.result?.advance ? "Advance finalized successfully. You can now allocate it to a posted invoice." : "Payment Entry finalized successfully.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Final Save failed"); }
    finally { setBusy(false); }
  }

  async function allocate(document: any) {
    const documentId = customerAdvance ? String(document.invoiceId || "") : String(document.billId || "");
    if (!documentId) return;
    const label = customerAdvance ? String(document.invoiceNumber || documentId) : String(document.billNumber || documentId);
    if (!window.confirm(`Allocate the full advance ${money(record.amount)} to ${label}?`)) return;
    setBusy(true); setMessage("Allocating advance…");
    try {
      const response = await fetch("/api/erp/transactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allocateAdvance", payload: {
          paymentId: record.paymentId,
          partyType: record.partyType,
          againstDocumentType: customerAdvance ? "Sales Invoice" : "Supplier Invoice",
          againstDocumentId: documentId,
        } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Advance allocation failed");
      setMessage(`Advance allocated to ${label}.`);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Advance allocation failed"); }
    finally { setBusy(false); }
  }

  if (!approved && !finalized) return null;

  return <>
    <section className="panel no-print" style={{ marginTop: 20 }}>
      <div className="form-title-row">
        <div><h3>{finalized ? "Payment Entry Finalized" : "Approved Payment Entry — Final Review"}</h3><p className="small">{directAdvance ? (customerAdvance ? "This is a Customer Advance: Dr Cash/Bank, Cr Customer Advances. Allocate it later to a posted Sales Invoice." : "This is a Supplier Advance: Dr Supplier Advances, Cr Cash/Bank. Allocate it later to a posted Supplier Invoice.") : "Approval authorizes the payment. Final Save creates the accounting effect."}</p></div>
        <span className="auto-badge">{finalized ? (directAdvance ? "FINALIZED ADVANCE" : "FINALIZED") : "APPROVED — EDITABLE"}</span>
      </div>

      <form className="form-grid" onSubmit={finalSave} style={{ marginTop: 18 }}>
        <label>Payment Entry No<input value={record.paymentNumber || record.paymentId} readOnly /></label>
        <label>Customer / Supplier<input value={record.partyId || ""} readOnly /></label>
        <label>Against Document<input value={`${record.againstDocumentType || ""} ${record.againstDocumentId || ""}`.trim() || (directAdvance ? "Unallocated Advance" : "—")} readOnly /></label>
        <label>Project<input value={record.projectId || ""} readOnly /></label>
        <label>Payment Date<input name="paymentDate" type="date" defaultValue={String(record.paymentDate || "").slice(0, 10)} required disabled={finalized || busy} /></label>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={Number(record.amount || 0)} required disabled={finalized || busy} /></label>
        <label>Payment Method<select name="paymentMethod" defaultValue={record.paymentMethod || ""} required disabled={finalized || busy}><option value="">Select method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
        <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue={record.cashBankAccountId || ""} placeholder="Select / enter cash or bank account" required disabled={finalized || busy} /></label>
        <label className="form-wide">Reference<input name="reference" defaultValue={record.reference || ""} placeholder="Bank reference / receipt reference" disabled={finalized || busy} /></label>
        {!finalized && <div className="form-wide"><button type="submit" disabled={busy}>{busy ? "Finalizing…" : "Final Save"}</button></div>}
      </form>
      {message && <div className="status-banner" style={{ marginTop: 14 }}>{message}</div>}
    </section>

    {directAdvance && <section className="panel table-wrap no-print" style={{ marginTop: 20 }}>
      <div className="form-title-row"><div><h3>Allocate Advance</h3><p className="small">Only documents for the same party with enough outstanding balance are listed. Current Accounting 0.5 allocation applies the full advance to one document; split allocation will require a dedicated reconciliation document.</p></div><span className="auto-badge">{loadingDocs ? "Loading…" : `${documents.length} Eligible`}</span></div>
      <table className="data-table"><thead><tr><th>{customerAdvance ? "Sales Invoice" : "Supplier Invoice"}</th><th>Project</th><th>Total</th><th>Outstanding</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {!loadingDocs && documents.length === 0 && <tr><td colSpan={6}>No eligible posted document has outstanding balance of at least {money(record.amount)}.</td></tr>}
        {documents.map((row) => {
          const id = customerAdvance ? row.invoiceId : row.billId;
          const number = customerAdvance ? row.invoiceNumber : row.billNumber;
          const type = customerAdvance ? "invoice" : "supplierBill";
          return <tr key={id}><td><Link prefetch={false} href={`/transactions/${type}/${encodeURIComponent(id)}`}><strong>{number || id}</strong></Link></td><td>{row.projectId || "—"}</td><td>{money(row.totalAmount)}</td><td><strong>{money(row.outstandingAmount ?? row.totalAmount)}</strong></td><td>{row.status}</td><td><button type="button" disabled={busy} onClick={() => void allocate(row)}>{busy ? "Working…" : "Allocate Full Advance"}</button></td></tr>;
        })}
      </tbody></table>
    </section>}
  </>;
}
