"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "menu" | "invoice" | "direct";
type Master = { customers: any[]; projects: any[] };

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const normalize = (value: unknown) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function customerId(row: any) { return String(row.customerId || ""); }
function customerName(row: any) { return String(row.customerName || customerId(row)); }
function customerDisplay(row: any) {
  const id = customerId(row), name = customerName(row);
  return id && name !== id ? `${name} (${id})` : name;
}
function resolveCustomer(rows: any[], input: string) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  return rows.find((row) => customerDisplay(row).toLowerCase() === q)
    || rows.find((row) => customerId(row).toLowerCase() === q)
    || rows.find((row) => customerName(row).toLowerCase() === q)
    || null;
}

const returnQuery = "returnModule=sales&returnTab=salesPayment&returnMode=create";

export default function SalesPaymentStaged() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("menu");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextNo, setNextNo] = useState("AUTO");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [searched, setSearched] = useState<any | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [masters, setMasters] = useState<Master>({ customers: [], projects: [] });
  const [mastersLoaded, setMastersLoaded] = useState(false);
  const [customerInput, setCustomerInput] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");

  const approved = useMemo(() => invoices.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.outstandingAmount ?? row.totalAmount ?? 0) > 0), [invoices]);
  const projectOptions = useMemo(() => {
    if (!selectedCustomer) return masters.projects;
    const linked = masters.projects.filter((row) => String(row.customerId || "") === selectedCustomer);
    return linked.length ? linked : masters.projects;
  }, [masters.projects, selectedCustomer]);

  async function loadNextNo() {
    try {
      const response = await fetch("/api/erp/transactions?nextNumberFor=createPayment&partyType=Customer", { cache: "no-store" });
      const body = await response.json();
      setNextNo(response.ok && body.ok ? body.nextNumber || "AUTO" : "AUTO");
    } catch {
      setNextNo("AUTO");
    }
  }

  async function loadInvoices() {
    if (invoicesLoaded) return invoices;
    setLoading(true);
    try {
      const response = await fetch("/api/erp/transactions", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Sales Invoice load failed");
      const rows = Array.isArray(body.invoices) ? body.invoices : [];
      setInvoices(rows);
      setInvoicesLoaded(true);
      return rows;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sales Invoice load failed");
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
      if (!response.ok || !body.ok) throw new Error(body.error || "Customer master load failed");
      setMasters({ customers: body.customers || [], projects: body.projects || [] });
      setMastersLoaded(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Customer master load failed");
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
    setCustomerInput("");
    setSelectedCustomer("");
    await Promise.all([loadMasters(), loadNextNo()]);
  }

  function backToPaymentChoices() {
    setMode("menu");
    setStatus("");
    setSearch("");
    setSearched(null);
    setSelectedInvoice(null);
    setCustomerInput("");
    setSelectedCustomer("");
  }

  function selectInvoice(row: any) {
    setSelectedInvoice(row);
    setSearched(row);
    setStatus("");
    window.setTimeout(() => document.getElementById("sales-payment-invoice-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function searchInvoice() {
    let rows = invoices;
    if (!invoicesLoaded) rows = await loadInvoices();
    const q = normalize(search);
    if (!q) { setSearched(null); setStatus("Enter a Sales Invoice number"); return; }
    const available = rows.filter((row) => String(row.status || "").toUpperCase() === "APPROVED" && Number(row.outstandingAmount ?? row.totalAmount ?? 0) > 0);
    const match = available.find((row) => normalize(row.invoiceNumber) === q || normalize(row.invoiceId) === q)
      || available.find((row) => normalize(row.invoiceNumber).includes(q) || normalize(row.invoiceId).includes(q));
    if (!match) { setSearched(null); setStatus(`Approved Sales Invoice with outstanding amount not found: ${search}`); return; }
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
    if (!response.ok || !body.ok) throw new Error(body.error || "Sales Payment draft save failed");
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
      if (amount > outstanding + 0.001) throw new Error("Payment amount cannot exceed Sales Invoice outstanding amount");
      const result = await createPayment({
        paymentNumber: "",
        paymentType: "RECEIVE",
        partyType: "Customer",
        partyId: selectedInvoice.customerId,
        projectId: selectedInvoice.projectId || "",
        paymentDate: form.get("paymentDate"),
        amount,
        paymentMethod: form.get("paymentMethod"),
        cashBankAccountId: form.get("cashBankAccountId"),
        reference: form.get("reference") || "",
        againstDocumentType: "Sales Invoice",
        againstDocumentId: selectedInvoice.invoiceId,
      });
      router.push(`/transactions/payment/${result.recordId}?${returnQuery}`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sales Payment draft save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveDirectPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving Direct Payment Entry…");
    try {
      const form = new FormData(event.currentTarget);
      const match = selectedCustomer ? masters.customers.find((row) => customerId(row) === selectedCustomer) : resolveCustomer(masters.customers, customerInput);
      if (!match) throw new Error("Select a valid Customer from the suggestions");
      const amount = Number(form.get("amount") || 0);
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      const result = await createPayment({
        paymentNumber: "",
        paymentType: "RECEIVE",
        partyType: "Customer",
        partyId: customerId(match),
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
      setStatus(error instanceof Error ? error.message : "Direct Payment Entry save failed");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {status && <section className="panel status-banner">{status}</section>}

    {mode === "menu" && <section className="panel">
      <div className="form-title-row"><div><h3>Create New Sales Payment Entry / Receipt</h3><p className="small">Choose whether this receipt is allocated to an approved Sales Invoice or entered directly against a Customer without selecting an invoice.</p></div></div>
      <div className="button-row" style={{ marginTop: 18, alignItems: "stretch" }}>
        <button type="button" style={{ minHeight: 86, flex: "1 1 320px", textAlign: "left" }} onClick={() => void openInvoiceMode()}>
          <strong style={{ display: "block" }}>Approved Sales Invoices Pending Payment</strong>
          <span style={{ display: "block", marginTop: 7, fontWeight: 400 }}>Select an approved invoice and create an allocated Customer receipt.</span>
        </button>
        <button type="button" className="secondary" style={{ minHeight: 86, flex: "1 1 320px", textAlign: "left" }} onClick={() => void openDirectMode()}>
          <strong style={{ display: "block" }}>Direct Payment Entry Without Sales Invoice</strong>
          <span style={{ display: "block", marginTop: 7, fontWeight: 400 }}>Create an unallocated Customer receipt without linking a Sales Invoice.</span>
        </button>
      </div>
    </section>}

    {mode !== "menu" && <section className="panel">
      <div className="button-row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="secondary" onClick={backToPaymentChoices}>← Back to Create Sales Payment Entry / Receipt</button>
        <span className="auto-badge">Next Payment No: {nextNo || "AUTO"}</span>
      </div>
    </section>}

    {mode === "invoice" && <>
      <section className="panel table-wrap">
        <div className="form-title-row"><h3>Approved Sales Invoices Pending Payment</h3><span className="auto-badge">{loading ? "Loading…" : `${approved.length} Pending`}</span></div>
        <table className="data-table"><thead><tr><th>Sales Invoice</th><th>Customer</th><th>Project</th><th>Invoice Total</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>
          {!loading && approved.length === 0 && <tr><td colSpan={6}>No approved Sales Invoices with outstanding balance.</td></tr>}
          {approved.map((invoice) => <tr key={invoice.invoiceId}><td><Link prefetch={false} href={`/transactions/invoice/${invoice.invoiceId}?${returnQuery}`}><strong>{invoice.invoiceNumber || invoice.invoiceId}</strong></Link></td><td>{invoice.customerId || "—"}</td><td>{invoice.projectId || "—"}</td><td>{money(invoice.totalAmount)}</td><td><strong>{money(invoice.outstandingAmount ?? invoice.totalAmount)}</strong></td><td><button type="button" onClick={() => selectInvoice(invoice)}>Create Payment</button></td></tr>)}
        </tbody></table>
      </section>

      <section className="panel">
        <h3>Search Approved Sales Invoice</h3>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>Sales Invoice No<input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchInvoice(); } }} placeholder="e.g. SI-2026-00001" autoComplete="off" /></label>
          <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ width: "100%", height: 52 }} onClick={() => void searchInvoice()} disabled={loading}>{loading ? "Searching…" : "Search"}</button></div>
        </div>
        {searched && <div style={{ marginTop: 20 }}><div className="document-meta"><div><span>Sales Invoice</span><strong>{searched.invoiceNumber || searched.invoiceId}</strong></div><div><span>Customer</span><strong>{searched.customerId || "—"}</strong></div><div><span>Project</span><strong>{searched.projectId || "—"}</strong></div><div><span>Invoice Total</span><strong>{money(searched.totalAmount)}</strong></div><div><span>Outstanding</span><strong>{money(searched.outstandingAmount ?? searched.totalAmount)}</strong></div><div><span>Status</span><strong>{searched.status}</strong></div></div><div className="button-row" style={{ marginTop: 18 }}><button type="button" onClick={() => selectInvoice(searched)}>Create Payment Entry</button></div></div>}
      </section>

      {selectedInvoice && <form id="sales-payment-invoice-form" className="panel form-grid" onSubmit={saveInvoicePayment}>
        <h3 className="form-title">Sales Payment Entry / Receipt Against Invoice</h3>
        <label>Sales Invoice<input value={selectedInvoice.invoiceNumber || selectedInvoice.invoiceId} readOnly /></label>
        <label>Customer<input value={selectedInvoice.customerId || ""} readOnly /></label>
        <label>Project<input value={selectedInvoice.projectId || "No project"} readOnly /></label>
        <label>Auto Payment No<input value={nextNo || "AUTO"} readOnly /></label>
        <label>Invoice Total<input value={money(selectedInvoice.totalAmount)} readOnly /></label>
        <label>Outstanding<input value={money(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount)} readOnly /></label>
        <label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required /></label>
        <label>Amount<input name="amount" type="number" min="0.01" max={Number(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount ?? 0)} step="0.01" defaultValue={Number(selectedInvoice.outstandingAmount ?? selectedInvoice.totalAmount ?? 0)} required /></label>
        <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
        <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="e.g. ACC-1120" required /></label>
        <label className="form-wide">Reference<input name="reference" placeholder="Bank / receipt reference" /></label>
        <div className="form-wide button-row"><button type="button" className="secondary" onClick={() => setSelectedInvoice(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving Draft…" : "Save Payment Draft"}</button></div>
      </form>}
    </>}

    {mode === "direct" && <form className="panel form-grid" onSubmit={saveDirectPayment}>
      <h3 className="form-title">Direct Payment Entry Without Sales Invoice</h3>
      <label>Customer<input list="direct-payment-customer-suggestions" value={customerInput} onChange={(e) => { const value = e.target.value; setCustomerInput(value); const match = resolveCustomer(masters.customers, value); setSelectedCustomer(match ? customerId(match) : ""); }} placeholder="Type customer name or ID" autoComplete="off" required /><datalist id="direct-payment-customer-suggestions">{masters.customers.map((row) => <option key={customerId(row)} value={customerDisplay(row)} />)}</datalist></label>
      <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projectOptions.map((row) => <option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select></label>
      <label>Auto Payment No<input value={nextNo || "AUTO"} readOnly /></label>
      <label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required /></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="e.g. ACC-1120" required /></label>
      <label className="form-wide">Reference<input name="reference" placeholder="Bank / receipt reference" /></label>
      <div className="form-wide"><p className="small">This receipt is not allocated to a Sales Invoice. When finalized, it posts to the Customer account as an unallocated receipt/credit that can be reconciled later.</p></div>
      <div className="form-wide button-row"><button type="submit" disabled={busy || loading}>{busy ? "Saving Draft…" : "Save Direct Payment Draft"}</button></div>
    </form>}
  </>;
}
