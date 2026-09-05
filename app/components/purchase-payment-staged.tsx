"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const normalize = (value: unknown) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function PurchasePaymentStaged() {
  const router = useRouter();
  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [showApproved, setShowApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searched, setSearched] = useState<any | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextNo, setNextNo] = useState("Loading…");

  async function loadTransactions() {
    setLoading(true);
    try {
      const response = await fetch("/api/erp/transactions", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoices load failed");
      const rows = Array.isArray(body.supplierBills) ? body.supplierBills : [];
      setSupplierInvoices(rows);
      return rows;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Supplier Invoices load failed");
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function loadNextNo() {
    try {
      const response = await fetch("/api/erp/transactions?nextNumberFor=createPayment&partyType=Supplier", { cache: "no-store" });
      const body = await response.json();
      setNextNo(response.ok && body.ok ? body.nextNumber || "AUTO" : "AUTO");
    } catch {
      setNextNo("AUTO");
    }
  }

  useEffect(() => { void loadNextNo(); }, []);

  const approved = useMemo(() => supplierInvoices.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.outstandingAmount ?? row.totalAmount ?? 0) > 0), [supplierInvoices]);

  async function toggleApproved() {
    if (showApproved) { setShowApproved(false); return; }
    if (!supplierInvoices.length) await loadTransactions();
    setShowApproved(true);
  }

  async function searchApproved() {
    let rows = supplierInvoices;
    if (!rows.length) rows = await loadTransactions();
    const q = normalize(search);
    if (!q) { setSearched(null); setStatus("Enter a Supplier Invoice number"); return; }
    const available = rows.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.outstandingAmount ?? row.totalAmount ?? 0) > 0);
    const match = available.find((row) => normalize(row.billNumber) === q || normalize(row.billId) === q)
      || available.find((row) => normalize(row.billNumber).includes(q) || normalize(row.billId).includes(q));
    if (!match) { setSearched(null); setStatus(`Approved Supplier Invoice with outstanding amount not found: ${search}`); return; }
    setStatus("");
    setSearched(match);
  }

  function selectForPayment(row: any) {
    setSelected(row);
    setSearched(row);
    setShowApproved(false);
    setStatus("");
    window.setTimeout(() => document.getElementById("purchase-payment-draft-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const amount = Number(form.get("amount") || 0);
      const outstanding = Number(selected.outstandingAmount ?? selected.totalAmount ?? 0);
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      if (amount > outstanding + 0.001) throw new Error("Payment amount cannot exceed Supplier Invoice outstanding amount");
      const response = await fetch("/api/erp/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPayment",
          payload: {
            paymentNumber: "",
            paymentType: "PAY",
            partyType: "Supplier",
            partyId: selected.supplierId,
            projectId: selected.projectId || "",
            paymentDate: form.get("paymentDate"),
            amount,
            paymentMethod: form.get("paymentMethod"),
            cashBankAccountId: form.get("cashBankAccountId"),
            reference: form.get("reference") || "",
            againstDocumentType: "Supplier Invoice",
            againstDocumentId: selected.billId,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Purchase Payment draft save failed");
      router.push(`/transactions/payment/${body.result.recordId}`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Purchase Payment draft save failed");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {status && <section className="panel status-banner">{status}</section>}
    <section className="panel">
      <div className="form-title-row">
        <div>
          <h3>Supplier Invoice → Purchase Payment Entry / Receipt</h3>
          <p className="small">Choose an approved Supplier Invoice first. Convert Now only opens the Payment Entry form; no draft is created until Save Draft.</p>
        </div>
        <span className="auto-badge">Next Payment No: {nextNo}</span>
      </div>
      <div className="button-row" style={{ marginTop: 18 }}>
        <button type="button" onClick={() => void toggleApproved()} disabled={loading}>{loading ? "Loading…" : showApproved ? "Hide Approved Supplier Invoices" : "View Approved Supplier Invoice to Payment Entry"}</button>
      </div>
    </section>

    {showApproved && <section className="panel table-wrap">
      <div className="form-title-row"><h3>Approved Supplier Invoices Pending Payment Entry</h3><span className="auto-badge">{approved.length} Pending</span></div>
      <table className="data-table"><thead><tr><th>Supplier Invoice</th><th>Supplier</th><th>Project</th><th>Invoice Total</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>
        {approved.length === 0 && <tr><td colSpan={6}>No approved Supplier Invoices with outstanding balance.</td></tr>}
        {approved.map((invoice) => <tr key={invoice.billId}><td><Link href={`/transactions/supplierBill/${invoice.billId}`}><strong>{invoice.billNumber || invoice.billId}</strong></Link></td><td>{invoice.supplierId || "—"}</td><td>{invoice.projectId || "—"}</td><td>{money(invoice.totalAmount)}</td><td><strong>{money(invoice.outstandingAmount ?? invoice.totalAmount)}</strong></td><td><button type="button" onClick={() => selectForPayment(invoice)}>Convert Now</button></td></tr>)}
      </tbody></table>
    </section>}

    <section className="panel">
      <h3>Manual Search by Supplier Invoice No</h3>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <label>Supplier Invoice No<input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchApproved(); } }} placeholder="e.g. PB-2026-00001" autoComplete="off" /></label>
        <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ width: "100%", height: 52 }} onClick={() => void searchApproved()} disabled={loading}>{loading ? "Searching…" : "Search"}</button></div>
      </div>
      {searched && <div style={{ marginTop: 20 }}><div className="document-meta">
        <div><span>Supplier Invoice</span><strong><Link href={`/transactions/supplierBill/${searched.billId}`}>{searched.billNumber || searched.billId}</Link></strong></div>
        <div><span>Supplier</span><strong>{searched.supplierId || "—"}</strong></div>
        <div><span>Project</span><strong>{searched.projectId || "—"}</strong></div>
        <div><span>Invoice Total</span><strong>{money(searched.totalAmount)}</strong></div>
        <div><span>Outstanding</span><strong>{money(searched.outstandingAmount ?? searched.totalAmount)}</strong></div>
        <div><span>Status</span><strong>{searched.status}</strong></div>
      </div><div className="button-row" style={{ marginTop: 18 }}><button type="button" onClick={() => selectForPayment(searched)}>Convert to Payment Entry</button></div></div>}
    </section>

    {selected && <form id="purchase-payment-draft-form" className="panel form-grid" onSubmit={saveDraft}>
      <h3 className="form-title">New Purchase Payment Entry / Receipt</h3>
      <label>Supplier Invoice<input value={selected.billNumber || selected.billId} readOnly /></label>
      <label>Supplier<input value={selected.supplierId || ""} readOnly /></label>
      <label>Project<input value={selected.projectId || "No project"} readOnly /></label>
      <label>Auto Purchase Payment / Receipt No<input value={nextNo} readOnly /></label>
      <label>Invoice Total<input value={money(selected.totalAmount)} readOnly /></label>
      <label>Outstanding<input value={money(selected.outstandingAmount ?? selected.totalAmount)} readOnly /></label>
      <label>Payment Date<input name="paymentDate" type="date" required /></label>
      <label>Amount<input name="amount" type="number" min="0.01" max={Number(selected.outstandingAmount ?? selected.totalAmount ?? 0)} step="0.01" defaultValue={Number(selected.outstandingAmount ?? selected.totalAmount ?? 0)} required /></label>
      <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="Select / enter cash or bank account" required /></label>
      <label className="form-wide">Reference<input name="reference" placeholder="Bank reference / supplier payment reference" /></label>
      <div className="form-wide button-row"><button type="button" className="secondary" onClick={() => setSelected(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving Draft…" : "Save Draft"}</button></div>
    </form>}
  </>;
}
