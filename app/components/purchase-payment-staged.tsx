"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const normalize = (value: unknown) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function PurchasePaymentStaged() {
  const router = useRouter();
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
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
      if (!response.ok || !body.ok) throw new Error(body.error || "Purchase documents load failed");
      const rows = Array.isArray(body.purchaseOrders) ? body.purchaseOrders : [];
      setPurchaseOrders(rows);
      return rows;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Purchase documents load failed");
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

  const approved = useMemo(() => purchaseOrders.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.totalAmount || 0) > 0), [purchaseOrders]);

  async function toggleApproved() {
    if (showApproved) { setShowApproved(false); return; }
    if (!purchaseOrders.length) await loadTransactions();
    setShowApproved(true);
  }

  async function searchApproved() {
    let rows = purchaseOrders;
    if (!rows.length) rows = await loadTransactions();
    const q = normalize(search);
    if (!q) { setSearched(null); setStatus("Enter a Purchase Order number"); return; }
    const available = rows.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.totalAmount || 0) > 0);
    const match = available.find((row) => normalize(row.poNumber) === q || normalize(row.poId) === q)
      || available.find((row) => normalize(row.poNumber).includes(q) || normalize(row.poId).includes(q));
    if (!match) { setSearched(null); setStatus(`Approved Purchase Order not found: ${search}`); return; }
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
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      if (amount > Number(selected.totalAmount || 0) + 0.001) throw new Error("Payment amount cannot exceed Purchase Order total");
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
            againstDocumentType: "Purchase Order",
            againstDocumentId: selected.poId,
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
          <h3>Purchase Order → Purchase Payment / Receipt</h3>
          <p className="small">Choose an approved Purchase Order first. Convert Now only opens the Payment Entry form; no draft is created until Save Draft.</p>
        </div>
        <span className="auto-badge">Next Payment No: {nextNo}</span>
      </div>
      <div className="button-row" style={{ marginTop: 18 }}>
        <button type="button" onClick={() => void toggleApproved()} disabled={loading}>{loading ? "Loading…" : showApproved ? "Hide Approved Purchase Orders" : "View Approved Purchase Order to Payment Entry"}</button>
      </div>
    </section>

    {showApproved && <section className="panel table-wrap">
      <div className="form-title-row"><h3>Approved Purchase Orders Pending Payment Entry</h3><span className="auto-badge">{approved.length} Pending</span></div>
      <table className="data-table"><thead><tr><th>Purchase Order</th><th>Supplier</th><th>Project</th><th>PO Total</th><th>Action</th></tr></thead><tbody>
        {approved.length === 0 && <tr><td colSpan={5}>No approved Purchase Orders pending payment.</td></tr>}
        {approved.map((po) => <tr key={po.poId}><td><Link href={`/transactions/purchaseOrder/${po.poId}`}><strong>{po.poNumber || po.poId}</strong></Link></td><td>{po.supplierId || "—"}</td><td>{po.projectId || "—"}</td><td><strong>{money(po.totalAmount)}</strong></td><td><button type="button" onClick={() => selectForPayment(po)}>Convert Now</button></td></tr>)}
      </tbody></table>
    </section>}

    <section className="panel">
      <h3>Manual Search by Purchase Order No</h3>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <label>Purchase Order No<input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchApproved(); } }} placeholder="e.g. PO-2026-00001" autoComplete="off" /></label>
        <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ width: "100%", height: 52 }} onClick={() => void searchApproved()} disabled={loading}>{loading ? "Searching…" : "Search"}</button></div>
      </div>
      {searched && <div style={{ marginTop: 20 }}><div className="document-meta">
        <div><span>Purchase Order</span><strong><Link href={`/transactions/purchaseOrder/${searched.poId}`}>{searched.poNumber || searched.poId}</Link></strong></div>
        <div><span>Supplier</span><strong>{searched.supplierId || "—"}</strong></div>
        <div><span>Project</span><strong>{searched.projectId || "—"}</strong></div>
        <div><span>PO Total</span><strong>{money(searched.totalAmount)}</strong></div>
        <div><span>Status</span><strong>{searched.status}</strong></div>
      </div><div className="button-row" style={{ marginTop: 18 }}><button type="button" onClick={() => selectForPayment(searched)}>Convert to Payment Entry</button></div></div>}
    </section>

    {selected && <form id="purchase-payment-draft-form" className="panel form-grid" onSubmit={saveDraft}>
      <h3 className="form-title">New Purchase Payment / Receipt</h3>
      <label>Purchase Order<input value={selected.poNumber || selected.poId} readOnly /></label>
      <label>Supplier<input value={selected.supplierId || ""} readOnly /></label>
      <label>Project<input value={selected.projectId || "No project"} readOnly /></label>
      <label>Auto Purchase Payment / Receipt No<input value={nextNo} readOnly /></label>
      <label>Purchase Order Total<input value={money(selected.totalAmount)} readOnly /></label><div></div>
      <label>Payment Date<input name="paymentDate" type="date" required /></label>
      <label>Amount<input name="amount" type="number" min="0.01" max={Number(selected.totalAmount || 0)} step="0.01" defaultValue={Number(selected.totalAmount || 0)} required /></label>
      <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="Select / enter cash or bank account" required /></label>
      <label className="form-wide">Reference<input name="reference" placeholder="Bank reference / supplier payment reference" /></label>
      <div className="form-wide button-row"><button type="button" className="secondary" onClick={() => setSelected(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving Draft…" : "Save Draft"}</button></div>
    </form>}
  </>;
}
