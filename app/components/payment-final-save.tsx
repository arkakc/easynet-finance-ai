"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PaymentRecord = {
  paymentId: string;
  paymentNumber?: string;
  paymentType?: string;
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

type CashBankAccount = {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: number;
};

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const eligibleStatus = (value: unknown) => ["POSTED", "PARTLY_PAID", "APPROVED"].includes(String(value || "").toUpperCase());

function partyLabel(record: PaymentRecord, masters: any) {
  const id = String(record.partyId || "");
  if (!id) return "—";
  const rows = String(record.partyType || "") === "Supplier" ? masters.suppliers || [] : masters.customers || [];
  const row = rows.find((item: any) => String(item.supplierId || item.customerId || "") === id);
  const name = row ? String(row.supplierName || row.customerName || id) : id;
  return name !== id ? `${name} (${id})` : id;
}

function projectLabel(id: string, projects: any[]) {
  if (!id) return "No project";
  const row = projects.find((item: any) => String(item.projectId || "") === id);
  const name = row ? String(row.projectName || id) : id;
  return name !== id ? `${name} (${id})` : id;
}

export default function PaymentFinalSave({ record }: { record: PaymentRecord }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [masters, setMasters] = useState<any>({ customers: [], suppliers: [], projects: [] });
  const [selectedAccountId, setSelectedAccountId] = useState(String(record.cashBankAccountId || ""));
  const [amountValue, setAmountValue] = useState(Number(record.amount || 0));
  const [journalId, setJournalId] = useState(String(record.journalId || ""));
  const finalized = Boolean(journalId);
  const approved = String(record.status || "").toUpperCase() === "APPROVED";
  const directAdvance = finalized && !String(record.againstDocumentId || "").trim();
  const customerAdvance = String(record.partyType || "") === "Customer";
  const isPay = String(record.paymentType || "").toUpperCase() === "PAY";
  const selectedAccount = useMemo(() => accounts.find((row) => row.accountId === selectedAccountId) || null, [accounts, selectedAccountId]);
  const insufficientFunds = isPay && selectedAccount ? amountValue > Number(selectedAccount.balance || 0) + 0.001 : false;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [refResponse, masterResponse] = await Promise.all([
          fetch("/api/erp/reference-options", { cache: "no-store" }),
          fetch("/api/masters", { cache: "no-store" }),
        ]);
        const [refs, masterBody] = await Promise.all([refResponse.json(), masterResponse.json()]);
        if (!refResponse.ok || !refs.ok) throw new Error(refs.error || "Cash / Bank account list failed");
        if (!masterResponse.ok || !masterBody.ok) throw new Error(masterBody.error || "Master reference load failed");
        if (!active) return;
        setAccounts(refs.cashBankAccounts || []);
        setMasters({ customers: masterBody.customers || [], suppliers: masterBody.suppliers || [], projects: masterBody.projects || [] });
        if (!selectedAccountId && refs.cashBankAccounts?.length) setSelectedAccountId(String(refs.cashBankAccounts[0].accountId || ""));
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Reference data load failed");
      }
    })();
    return () => { active = false; };
  }, []);

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
    if (finalized || busy) return;
    if (insufficientFunds && selectedAccount) {
      setMessage(`Insufficient funds in ${selectedAccount.accountName} (${selectedAccount.accountId}). Available ${money(selectedAccount.balance)}, payment ${money(amountValue)}.`);
      return;
    }
    const confirmed = window.confirm("Are you sure you want to finalize this Payment Entry? This will create the accounting effect.");
    if (!confirmed) { setMessage("Final Save cancelled. The form is still editable."); return; }

    setBusy(true); setMessage("Final Saving Payment Entry… Please wait until accounting posting is complete.");
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
      const postedJournalId = String(body.result?.journalId || "");
      if (postedJournalId) setJournalId(postedJournalId);
      setMessage(body.result?.advance ? "Advance finalized successfully. You can now allocate it to a posted invoice." : "Payment Entry finalized successfully.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Final Save failed"); }
    finally { setBusy(false); }
  }

  async function allocate(document: any) {
    const documentId = customerAdvance ? String(document.invoiceId || "") : String(document.billId || "");
    if (!documentId || busy) return;
    const label = customerAdvance ? String(document.invoiceNumber || documentId) : String(document.billNumber || documentId);
    if (!window.confirm(`Allocate the full advance ${money(record.amount)} to ${label}?`)) return;
    setBusy(true); setMessage("Saving advance allocation…");
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
        <div><h3>{finalized ? "Payment Entry Finalized" : "Approved Payment Entry — Final Review"}</h3><p className="small">{directAdvance ? (customerAdvance ? "This is a Customer Advance: Dr Cash/Bank, Cr Customer Advances. Allocate it later to a posted Sales Invoice." : "This is a Supplier Advance: Dr Supplier Advances, Cr Cash/Bank. Allocate it later to a posted Supplier Invoice.") : "Approval authorizes the payment. Final Save creates the accounting effect. Supplier payments cannot overdraw Cash / Bank unless an overdraft workflow is introduced separately."}</p></div>
        <span className="auto-badge">{busy ? "SAVING…" : finalized ? (directAdvance ? "FINALIZED ADVANCE" : "FINALIZED") : "APPROVED — EDITABLE"}</span>
      </div>

      <form className="form-grid" onSubmit={finalSave} style={{ marginTop: 18 }}>
        <label>Payment Entry No<input value={record.paymentNumber || record.paymentId} readOnly /></label>
        <label>Customer / Supplier<input value={partyLabel(record, masters)} readOnly /></label>
        <label>Against Document<input value={`${record.againstDocumentType || ""} ${record.againstDocumentId || ""}`.trim() || (directAdvance ? "Unallocated Advance" : "—")} readOnly /></label>
        <label>Project<input value={projectLabel(String(record.projectId || ""), masters.projects || [])} readOnly /></label>
        <label>Payment Date<input name="paymentDate" type="date" defaultValue={String(record.paymentDate || "").slice(0, 10)} required disabled={finalized || busy} /></label>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" value={amountValue} onChange={(event) => setAmountValue(Number(event.target.value || 0))} required disabled={finalized || busy} /></label>
        <label>Payment Method<select name="paymentMethod" defaultValue={record.paymentMethod || ""} required disabled={finalized || busy}><option value="">Select method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
        <label>Cash / Bank Account<select name="cashBankAccountId" value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} required disabled={finalized || busy}><option value="">Select Cash / Bank account</option>{accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.accountName} ({account.accountId}) · Balance {money(account.balance)}</option>)}</select>{selectedAccount&&<span className="small">Available balance: <strong>{money(selectedAccount.balance)}</strong></span>}</label>
        <label className="form-wide">Reference<input name="reference" defaultValue={record.reference || ""} placeholder="Bank reference / receipt reference" disabled={finalized || busy} /></label>
        {insufficientFunds&&selectedAccount&&<div className="form-wide status-banner">Insufficient funds: {selectedAccount.accountName} ({selectedAccount.accountId}) has {money(selectedAccount.balance)}, but this payment is {money(amountValue)}. Final Save is blocked.</div>}
        {!finalized && <div className="form-wide"><button type="submit" disabled={busy || insufficientFunds || !selectedAccountId}>{busy ? "Saving…" : "Final Save"}</button></div>}
      </form>
      {message && <div className="status-banner" style={{ marginTop: 14 }}>{message}</div>}
      {journalId && <div className="button-row" style={{ marginTop: 14 }}><Link prefetch={false} className="button-link" href={`/journals/${encodeURIComponent(journalId)}`}>View Journal Entry · {journalId}</Link></div>}
    </section>

    {directAdvance && <section className="panel table-wrap no-print" style={{ marginTop: 20 }}>
      <div className="form-title-row"><div><h3>Allocate Advance</h3><p className="small">Only documents for the same party with enough outstanding balance are listed. Current Accounting 0.5 allocation applies the full advance to one document; split allocation will require a dedicated reconciliation document.</p></div><span className="auto-badge">{loadingDocs ? "Loading…" : `${documents.length} Eligible`}</span></div>
      <table className="data-table"><thead><tr><th>{customerAdvance ? "Sales Invoice" : "Supplier Invoice"}</th><th>Project</th><th>Total</th><th>Outstanding</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {!loadingDocs && documents.length === 0 && <tr><td colSpan={6}>No eligible posted document has outstanding balance of at least {money(record.amount)}.</td></tr>}
        {documents.map((row) => {
          const docId = customerAdvance ? row.invoiceId : row.billId;
          const number = customerAdvance ? row.invoiceNumber : row.billNumber;
          const type = customerAdvance ? "invoice" : "supplierBill";
          return <tr key={docId}><td><Link prefetch={false} href={`/transactions/${type}/${encodeURIComponent(docId)}`}><strong>{number || docId}</strong></Link></td><td>{projectLabel(String(row.projectId || ""), masters.projects || [])}</td><td>{money(row.totalAmount)}</td><td><strong>{money(row.outstandingAmount ?? row.totalAmount)}</strong></td><td>{row.status}</td><td><button type="button" disabled={busy} onClick={() => void allocate(row)}>{busy ? "Saving…" : "Allocate Full Advance"}</button></td></tr>;
        })}
      </tbody></table>
    </section>}
  </>;
}
