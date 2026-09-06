"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "menu" | "invoice" | "direct";
type Master = { suppliers: any[]; projects: any[] };

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const normalize = (value: unknown) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const returnQuery = "returnModule=purchase&returnTab=purchasePayment&returnMode=create";

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function supplierId(row: any) { return String(row.supplierId || ""); }
function supplierName(row: any) { return String(row.supplierName || supplierId(row)); }
function supplierDisplay(row: any) {
  const id = supplierId(row), name = supplierName(row);
  return id && name !== id ? `${name} (${id})` : name;
}
function resolveSupplier(rows: any[], input: string) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  return rows.find((row) => supplierDisplay(row).toLowerCase() === q)
    || rows.find((row) => supplierId(row).toLowerCase() === q)
    || rows.find((row) => supplierName(row).toLowerCase() === q)
    || null;
}

export default function PurchasePaymentStaged() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("menu");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextNo, setNextNo] = useState("AUTO");

  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [searched, setSearched] = useState<any | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);

  const [masters, setMasters] = useState<Master>({ suppliers: [], projects: [] });
  const [mastersLoaded, setMastersLoaded] = useState(false);
  const [supplierInput, setSupplierInput] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");

  const approved = useMemo(() => supplierInvoices.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.outstandingAmount ?? row.totalAmount ?? 0) > 0), [supplierInvoices]);
  const projectOptions = useMemo(() => masters.projects, [masters.projects]);

  async function loadNextNo() {
    try {
      const response = await fetch("/api/erp/transactions?nextNumberFor=createPayment&partyType=Supplier", { cache: "no-store" });
      const body = await response.json();
      setNextNo(response.ok && body.ok ? body.nextNumber || "AUTO" : "AUTO");
    } catch {
      setNextNo("AUTO");
    }
  }

  async function loadInvoices() {
    if (invoicesLoaded) return supplierInvoices;
    setLoading(true);
    try {
      const response = await fetch("/api/erp/transactions", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoice load failed");
      const rows = Array.isArray(body.supplierBills) ? body.supplierBills : [];
      setSupplierInvoices(rows);
      setInvoicesLoaded(true);
      return rows;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Supplier Invoice load failed");
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function loadMasters() {
    if (mastersLoaded) return;
    setLoading(true);
    try {
      const response = await fetch("/api/masters", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier master load failed");
      setMasters({ suppliers: body.suppliers || [], projects: body.projects || [] });
      setMastersLoaded(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Supplier master load failed");
    } finally {
      setLoading(false);
    }
  }

  async function openInvoiceMode() {
    setMode("invoice");
    setStatus("");
    setSelectedInvoice(null);
    setSearched(null);
    await Promise.all([loadInvoices(), loadNextNo()]);
  }

  async function openDirectMode() {
    setMode("direct");
    setStatus("");
    setSupplierInput("");
    setSelectedSupplier("");
    await Promise.all([loadMasters(), loadNextNo()]);
  }

  function backToPaymentChoices() {
    setMode("menu");
    setStatus("");
    setSearch("");
    setSearched(null);
    setSelectedInvoice(null);
    setSupplierInput("");
    setSelectedSupplier("");
  }

  function selectInvoice(row: any) {
    setSelectedInvoice(row);
    setSearched(row);
    setStatus("");
    window.setTimeout(() => document.getElementById("purchase-payment-invoice-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function searchInvoice() {
    let rows = supplierInvoices;
    if (!invoicesLoaded) rows = await loadInvoices();
    const q = normalize(search);
    if (!q) { setSearched(null); setStatus("Enter a Supplier Invoice number"); return; }
    const available = rows.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.outstandingAmount ?? row.totalAmount ?? 0) > 0);
    const match = available.find((row) => normalize(row.billNumber) === q || normalize(row.billId) === q)
      || available.find((row) => normalize(row.billNumber).includes(q) || normalize(row.billId).includes(q));
    if (!match) { setSearched(null); setStatus(`Approved Supplier Invoice with outstanding amount not found: ${search}`); return; }
    setStatus("");
    setSearched(match);
  }

  async function createPayment(payload: Record<string, unknown>) {
    const response = await fetch("/api/erp/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createPayment", payload }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Purchase Payment draft save failed");
    return body.result;
  }

  async function saveInvoicePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice) return;
    setBusy(true);
    setStatus("Saving Payment Entry…");
    try {
      const form = new FormData(event.currentTarget);
      const amount = Number(form.get("amount") || 0);
      const outstanding = Number(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount ?? 0);
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      if (amount > outstanding + 0.001) throw new Error("Payment amount cannot exceed Supplier Invoice outstanding amount");
      const result = await createPayment({
        paymentNumber: "",
        paymentType: "PAY",
        partyType: "Supplier",
        partyId: selectedInvoice.supplierId,
        projectId: selectedInvoice.projectId || "",
        paymentDate: form.get("paymentDate"),
        amount,
        paymentMethod: form.get("paymentMethod"),
        cashBankAccountId: form.get("cashBankAccountId"),
        reference: form.get("reference") || "",
        againstDocumentType: "Supplier Invoice",
        againstDocumentId: selectedInvoice.billId,
      });
      router.push(`/transactions/payment/${result.recordId}?${returnQuery}`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Purchase Payment draft save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveDirectPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving Direct Supplier Payment…");
    try {
      const form = new FormData(event.currentTarget);
      const match = selectedSupplier ? masters.suppliers.find((row) => supplierId(row) === selectedSupplier) : resolveSupplier(masters.suppliers, supplierInput);
      if (!match) throw new Error("Select a valid Supplier from the suggestions");
      const amount = Number(form.get("amount") || 0);
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      const result = await createPayment({
        paymentNumber: "",
        paymentType: "PAY",
        partyType: "Supplier",
        partyId: supplierId(match),
        projectId: form.get("projectId") || "",
        paymentDate: form.get("paymentDate"),
        amount,
        paymentMethod: form.get("paymentMethod"),
        cashBankAccountId: form.get("cashBankAccountId"),
        reference: form.get("reference") || "",
        againstDocumentType: "",
        againstDocumentId: "",
      });
      router.push(`/transactions/payment/${result.recordId}?${returnQuery}`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Direct Supplier Payment save failed");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {status && <section className="panel status-banner">{status}</section>}

    {mode === "menu" && <section className="panel">
      <div className="form-title-row"><div><h3>Create New Purchase Payment Entry / Receipt</h3><p className="small">Choose whether this Supplier payment is allocated to an approved Supplier Invoice or entered directly without selecting an invoice.</p></div></div>
      <div className="button-row" style={{ marginTop: 18, alignItems: "stretch" }}>
        <button type="button" style={{ minHeight: 86, flex: "1 1 320px", textAlign: "left" }} onClick={() => void openInvoiceMode()}>
          <strong style={{ display: "block" }}>Approved Supplier Invoices Pending Payment</strong>
          <span style={{ display: "block", marginTop: 7, fontWeight: 400 }}>Select an approved Supplier Invoice and create an allocated Supplier payment.</span>
        </button>
        <button type="button" className="secondary" style={{ minHeight: 86, flex: "1 1 320px", textAlign: "left" }} onClick={() => void openDirectMode()}>
          <strong style={{ display: "block" }}>Direct Payment Entry Without Supplier Invoice</strong>
          <span style={{ display: "block", marginTop: 7, fontWeight: 400 }}>Create an unallocated Supplier payment without linking a Supplier Invoice.</span>
        </button>
      </div>
    </section>}

    {mode !== "menu" && <section className="panel">
      <div className="button-row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="secondary" onClick={backToPaymentChoices}>← Back to Create Purchase Payment Entry / Receipt</button>
        <span className="auto-badge">Next Payment No: {nextNo || "AUTO"}</span>
      </div>
    </section>}

    {mode === "invoice" && <>
      <section className="panel table-wrap">
        <div className="form-title-row"><h3>Approved Supplier Invoices Pending Payment</h3><span className="auto-badge">{loading ? "Loading…" : `${approved.length} Pending`}</span></div>
        <table className="data-table"><thead><tr><th>Supplier Invoice</th><th>Supplier</th><th>Project</th><th>Invoice Total</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>
          {!loading && approved.length === 0 && <tr><td colSpan={6}>No approved Supplier Invoices with outstanding balance.</td></tr>}
          {approved.map((invoice) => <tr key={invoice.billId}><td><Link prefetch={false} href={`/transactions/supplierBill/${invoice.billId}?${returnQuery}`}><strong>{invoice.billNumber || invoice.billId}</strong></Link></td><td>{invoice.supplierId || "—"}</td><td>{invoice.projectId || "—"}</td><td>{money(invoice.totalAmount)}</td><td><strong>{money(invoice.outstandingAmount ?? invoice.totalAmount)}</strong></td><td><button type="button" onClick={() => selectInvoice(invoice)}>Create Payment</button></td></tr>)}
        </tbody></table>
      </section>

      <section className="panel">
        <h3>Search Approved Supplier Invoice</h3>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>Supplier Invoice No<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchInvoice(); } }} placeholder="e.g. PB-2026-00001" autoComplete="off" /></label>
          <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ width: "100%", height: 52 }} onClick={() => void searchInvoice()} disabled={loading}>{loading ? "Searching…" : "Search"}</button></div>
        </div>
        {searched && <div style={{ marginTop: 20 }}><div className="document-meta"><div><span>Supplier Invoice</span><strong>{searched.billNumber || searched.billId}</strong></div><div><span>Supplier</span><strong>{searched.supplierId || "—"}</strong></div><div><span>Project</span><strong>{searched.projectId || "—"}</strong></div><div><span>Invoice Total</span><strong>{money(searched.totalAmount)}</strong></div><div><span>Outstanding</span><strong>{money(searched.outstandingAmount ?? searched.totalAmount)}</strong></div><div><span>Status</span><strong>{searched.status}</strong></div></div><div className="button-row" style={{ marginTop: 18 }}><button type="button" onClick={() => selectInvoice(searched)}>Create Payment Entry</button></div></div>}
      </section>

      {selectedInvoice && <form id="purchase-payment-invoice-form" className="panel form-grid" onSubmit={saveInvoicePayment}>
        <h3 className="form-title">Purchase Payment Entry / Receipt Against Supplier Invoice</h3>
        <label>Supplier Invoice<input value={selectedInvoice.billNumber || selectedInvoice.billId} readOnly /></label>
        <label>Supplier<input value={selectedInvoice.supplierId || ""} readOnly /></label>
        <label>Project<input value={selectedInvoice.projectId || "No project"} readOnly /></label>
        <label>Auto Payment No<input value={nextNo || "AUTO"} readOnly /></label>
        <label>Invoice Total<input value={money(selectedInvoice.totalAmount)} readOnly /></label>
        <label>Outstanding<input value={money(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount)} readOnly /></label>
        <label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required /></label>
        <label>Amount<input name="amount" type="number" min="0.01" max={Number(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount ?? 0)} step="0.01" defaultValue={Number(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount ?? 0)} required /></label>
        <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
        <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="e.g. ACC-1120" required /></label>
        <label className="form-wide">Reference<input name="reference" placeholder="Bank / supplier payment reference" /></label>
        <div className="form-wide button-row"><button type="button" className="secondary" onClick={() => setSelectedInvoice(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving Draft…" : "Save Payment Draft"}</button></div>
      </form>}
    </>}

    {mode === "direct" && <form className="panel form-grid" onSubmit={saveDirectPayment}>
      <h3 className="form-title">Direct Payment Entry Without Supplier Invoice</h3>
      <label>Supplier<input list="direct-supplier-payment-suggestions" value={supplierInput} onChange={(event) => { const value = event.target.value; setSupplierInput(value); const match = resolveSupplier(masters.suppliers, value); setSelectedSupplier(match ? supplierId(match) : ""); }} placeholder="Type Supplier name or ID" autoComplete="off" required /><datalist id="direct-supplier-payment-suggestions">{masters.suppliers.map((row) => <option key={supplierId(row)} value={supplierDisplay(row)} />)}</datalist></label>
      <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projectOptions.map((row) => <option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select></label>
      <label>Auto Payment No<input value={nextNo || "AUTO"} readOnly /></label>
      <label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required /></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="e.g. ACC-1120" required /></label>
      <label className="form-wide">Reference<input name="reference" placeholder="Bank reference / advance / unallocated supplier payment reference" /></label>
      <div className="form-wide"><p className="small">This payment is not allocated to a Supplier Invoice. It will remain an unallocated Supplier payment for later reconciliation.</p></div>
      <div className="form-wide button-row"><button type="button" className="secondary" onClick={backToPaymentChoices}>Cancel</button><button type="submit" disabled={busy || loading}>{busy ? "Saving Draft…" : "Save Direct Payment Draft"}</button></div>
    </form>}
  </>;
}
