"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Module = "sales" | "purchase" | "expense";
type Tab = "salesQuote" | "salesInvoice" | "salesPayment" | "supplierQuote" | "purchaseOrder" | "purchasePayment" | "expense";
type Master = { customers: any[]; suppliers: any[]; projects: any[] };
type TxData = { quotes: any[]; supplierQuotes: any[]; purchaseOrders: any[]; invoices: any[]; supplierBills: any[]; payments: any[]; expenses: any[] };
type DraftLine = { description: string; qty: string; uom: string; rate: string };

const emptyMaster: Master = { customers: [], suppliers: [], projects: [] };
const emptyTx: TxData = { quotes: [], supplierQuotes: [], purchaseOrders: [], invoices: [], supplierBills: [], payments: [], expenses: [] };
const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

function localDate(plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [module, setModule] = useState<Module>("sales");
  const [tab, setTab] = useState<Tab>("salesInvoice");
  const [masters, setMasters] = useState<Master>(emptyMaster);
  const [tx, setTx] = useState<TxData>(emptyTx);
  const [status, setStatus] = useState("");
  const [selectedParty, setSelectedParty] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", qty: "1", uom: "Each", rate: "0" }]);

  async function load() {
    try {
      const [m, t] = await Promise.all([
        fetch("/api/masters").then((r) => r.json()),
        fetch("/api/erp/transactions").then((r) => r.json()),
      ]);
      if (!m.ok) throw new Error(m.error || "Master-data load failed");
      if (!t.ok) throw new Error(t.error || "Transaction load failed");
      setMasters({ customers: m.customers || [], suppliers: m.suppliers || [], projects: m.projects || [] });
      setTx({
        quotes: t.quotes || [],
        supplierQuotes: t.supplierQuotes || [],
        purchaseOrders: t.purchaseOrders || [],
        invoices: t.invoices || [],
        supplierBills: t.supplierBills || [],
        payments: t.payments || [],
        expenses: t.expenses || [],
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("module") as Module | null;
    const resolved: Module = requested === "purchase" || requested === "expense" ? requested : "sales";
    setModule(resolved);
    setTab(resolved === "purchase" ? "purchaseOrder" : resolved === "expense" ? "expense" : "salesInvoice");
    void load();
  }, []);

  const salesSide = module === "sales";
  const commercial = ["salesQuote", "salesInvoice", "supplierQuote", "purchaseOrder"].includes(tab);
  const partyOptions = salesSide ? masters.customers : masters.suppliers;
  const projectOptions = useMemo(() => {
    if (!salesSide || !selectedParty) return masters.projects;
    const linked = masters.projects.filter((p) => String(p.customerId || "") === selectedParty);
    return linked.length ? linked : masters.projects;
  }, [salesSide, selectedParty, masters.projects]);

  function setLine(index: number, field: keyof DraftLine, value: string) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }
  function addLine() { setLines((current) => [...current, { description: "", qty: "1", uom: "Each", rate: "0" }]); }
  function removeLine(index: number) { setLines((current) => current.length === 1 ? current : current.filter((_, i) => i !== index)); }

  async function call(action: string, payload: unknown) {
    setStatus("Saving…");
    const response = await fetch("/api/erp/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Transaction failed");
    setStatus(`${body.result?.documentNumber || body.result?.recordId || "Document"} saved successfully.`);
    await load();
    return body.result;
  }

  async function submitCommercial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const f = new FormData(event.currentTarget);
      const payload = {
        documentNumber: "",
        partyId: f.get("partyId"),
        projectId: f.get("projectId") ?? "",
        documentDate: f.get("documentDate"),
        dueDate: f.get("dueDate") ?? "",
        expiryDate: f.get("expiryDate") ?? "",
        gstRate: Number(f.get("gstRate") || 0) / 100,
        accountId: f.get("accountId") ?? "",
        poId: "",
        lines: lines.map((line) => ({ ...line, qty: Number(line.qty), rate: Number(line.rate) })),
      };
      const action = tab === "salesQuote" ? "createQuote" : tab === "salesInvoice" ? "createInvoice" : tab === "supplierQuote" ? "createSupplierQuote" : "createPurchaseOrder";
      const result = await call(action, payload);
      const detailType = tab === "salesQuote" ? "quote" : tab === "salesInvoice" ? "invoice" : "purchaseOrder";
      router.push(`/transactions/${detailType}/${result.recordId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const f = new FormData(event.currentTarget);
      const isSalesPayment = tab === "salesPayment";
      const result = await call("createPayment", {
        paymentNumber: "",
        paymentType: isSalesPayment ? "RECEIVE" : "PAY",
        partyType: isSalesPayment ? "Customer" : "Supplier",
        partyId: f.get("partyId"),
        projectId: f.get("projectId") ?? "",
        paymentDate: f.get("paymentDate"),
        amount: f.get("amount"),
        paymentMethod: f.get("paymentMethod"),
        cashBankAccountId: f.get("cashBankAccountId"),
        reference: f.get("reference") ?? "",
        againstDocumentType: f.get("againstDocumentType") ?? "",
        againstDocumentId: f.get("againstDocumentId") ?? "",
      });
      router.push(`/transactions/payment/${result.recordId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const f = new FormData(event.currentTarget);
      const result = await call("createExpense", { ...Object.fromEntries(f.entries()), expenseNumber: "" });
      router.push(`/transactions/expense/${result.recordId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function post(recordType: "invoice" | "payment" | "expense", recordId: string) {
    try { await call("post", { recordType, recordId }); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Post failed"); }
  }

  const tabButton = (value: Tab, label: string) => (
    <button type="button" key={value} className={tab === value ? "tab active" : "tab"} onClick={() => { setTab(value); setSelectedParty(""); }}>{label}</button>
  );
  const view = (type: string, id: string) => <Link className="button-link secondary-link" href={`/transactions/${type}/${id}`}>View / Print</Link>;

  const title = module === "sales" ? "Sales Transactions" : module === "purchase" ? "Purchase Transactions" : "Expenses";

  return <>
    <div className="page-heading"><div><h2>{title}</h2><p className="small">User login and role permission control every write action. No shared APP_SECRET is required in the UI.</p></div></div>

    {module === "sales" && <div className="tabs wrap-tabs">
      {tabButton("salesQuote", "Sales Quotation")}
      {tabButton("salesInvoice", "Sales Invoice")}
      {tabButton("salesPayment", "Sales Payment Entry / Receipt")}
    </div>}

    {module === "purchase" && <div className="tabs wrap-tabs">
      {tabButton("supplierQuote", "Supplier Quotation")}
      {tabButton("purchaseOrder", "Purchase Order")}
      {tabButton("purchasePayment", "Purchase Payment / Receipt")}
    </div>}

    {status && <section className="panel status-banner">{status}</section>}

    {commercial && <form className="panel" onSubmit={submitCommercial}>
      <div className="form-title-row"><h3>{tab === "salesQuote" ? "New Sales Quotation" : tab === "salesInvoice" ? "New Sales Invoice" : tab === "supplierQuote" ? "New Supplier Quotation" : "New Purchase Order"}</h3><span className="auto-badge">Document No: AUTO</span></div>
      <div className="form-grid">
        <label>{salesSide ? "Customer" : "Supplier"}<select name="partyId" required defaultValue="" onChange={(e) => setSelectedParty(e.target.value)}><option value="" disabled>Select</option>{partyOptions.map((p) => <option key={p.customerId || p.supplierId} value={p.customerId || p.supplierId}>{p.customerName || p.supplierName}</option>)}</select></label>
        <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projectOptions.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName} ({p.projectId})</option>)}</select></label>
        <label>Date<input name="documentDate" type="date" required defaultValue={localDate()} /></label>
        {tab === "salesInvoice" && <label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} /></label>}
        {(tab === "salesQuote" || tab === "supplierQuote") && <label>Valid Till<input name="expiryDate" type="date" defaultValue={localDate(7)} /></label>}
        <label>GST %<input name="gstRate" type="number" min="0" max="100" step="0.01" defaultValue="0" /></label>
        {tab === "salesInvoice" && <label>Revenue Account<input name="accountId" placeholder="ACC-4100" /></label>}
      </div>
      <h4>Lines</h4>
      {lines.map((line, index) => <div className="line-grid" key={index}>
        <input placeholder="Description" value={line.description} onChange={(e) => setLine(index, "description", e.target.value)} required />
        <input type="number" min="0.0001" step="0.0001" value={line.qty} onChange={(e) => setLine(index, "qty", e.target.value)} />
        <input placeholder="UOM" value={line.uom} onChange={(e) => setLine(index, "uom", e.target.value)} />
        <input type="number" min="0" step="0.01" value={line.rate} onChange={(e) => setLine(index, "rate", e.target.value)} />
        <button type="button" className="secondary" onClick={() => removeLine(index)}>Remove</button>
      </div>)}
      <div className="button-row"><button type="button" className="secondary" onClick={addLine}>Add Line</button><button type="submit">Save Draft</button></div>
    </form>}

    {(tab === "salesPayment" || tab === "purchasePayment") && <form className="panel form-grid" onSubmit={submitPayment}>
      <h3 className="form-title">{tab === "salesPayment" ? "New Sales Payment Entry / Receipt" : "New Purchase Payment / Receipt"} <span className="auto-badge">AUTO NO</span></h3>
      <label>{tab === "salesPayment" ? "Customer" : "Supplier"}<select name="partyId" required defaultValue=""><option value="" disabled>Select</option>{(tab === "salesPayment" ? masters.customers : masters.suppliers).map((p) => <option key={p.customerId || p.supplierId} value={p.customerId || p.supplierId}>{p.customerName || p.supplierName}</option>)}</select></label>
      <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{masters.projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label>
      <label>Date<input name="paymentDate" type="date" required defaultValue={localDate()} /></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Method<select name="paymentMethod"><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label>
      <label>Against Document Type<input name="againstDocumentType" placeholder={tab === "salesPayment" ? "Sales Invoice" : "Supplier Bill"} /></label>
      <label>Against Document ID<input name="againstDocumentId" /></label>
      <label className="form-wide">Reference<input name="reference" /></label>
      <div className="form-wide"><button type="submit">Save Draft</button></div>
    </form>}

    {tab === "expense" && <form className="panel form-grid" onSubmit={submitExpense}>
      <h3 className="form-title">New Expense <span className="auto-badge">AUTO NO</span></h3>
      <label>Date<input name="expenseDate" type="date" required defaultValue={localDate()} /></label>
      <label>Supplier ID<input name="supplierId" /></label>
      <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{masters.projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label>
      <label>Expense Account<input name="expenseAccountId" defaultValue="ACC-6600" required /></label>
      <label>Net Amount<input name="netAmount" type="number" min="0" step="0.01" required /></label>
      <label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
      <label>Payment Method<select name="paymentMethod"><option>Cash</option><option>Bank Transfer</option><option>Card</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label>
      <label className="form-wide">Description<input name="description" required /></label>
      <div className="form-wide"><button type="submit">Save Draft</button></div>
    </form>}

    <section className="panel table-wrap"><h3>Current Documents</h3><table className="data-table"><thead><tr><th>ID / Number</th><th>Party / Project</th><th>Total / Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {tab === "salesQuote" && tx.quotes.map((r) => <tr key={r.quoteId}><td>{r.quoteNumber}</td><td>{r.customerId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td>{view("quote", r.quoteId)}</td></tr>)}
      {tab === "salesInvoice" && tx.invoices.map((r) => <tr key={r.invoiceId}><td>{r.invoiceNumber}</td><td>{r.customerId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}<br/><span className="small">Outstanding {money(r.outstandingAmount)}</span></td><td>{r.status}</td><td><div className="row-actions">{view("invoice", r.invoiceId)}{r.status === "DRAFT" && <button onClick={() => post("invoice", r.invoiceId)}>Post</button>}</div></td></tr>)}
      {tab === "supplierQuote" && tx.supplierQuotes.map((r) => <tr key={r.poId}><td>{r.poNumber}</td><td>{r.supplierId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td>{view("purchaseOrder", r.poId)}</td></tr>)}
      {tab === "purchaseOrder" && tx.purchaseOrders.map((r) => <tr key={r.poId}><td>{r.poNumber}</td><td>{r.supplierId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td>{view("purchaseOrder", r.poId)}</td></tr>)}
      {tab === "salesPayment" && tx.payments.filter((r) => r.partyType === "Customer").map((r) => <tr key={r.paymentId}><td>{r.paymentNumber}</td><td>Customer: {r.partyId}<br/>{r.projectId}</td><td>{money(r.amount)}</td><td>{r.status}</td><td><div className="row-actions">{view("payment", r.paymentId)}{r.status === "DRAFT" && <button onClick={() => post("payment", r.paymentId)}>Post</button>}</div></td></tr>)}
      {tab === "purchasePayment" && tx.payments.filter((r) => r.partyType === "Supplier").map((r) => <tr key={r.paymentId}><td>{r.paymentNumber}</td><td>Supplier: {r.partyId}<br/>{r.projectId}</td><td>{money(r.amount)}</td><td>{r.status}</td><td><div className="row-actions">{view("payment", r.paymentId)}{r.status === "DRAFT" && <button onClick={() => post("payment", r.paymentId)}>Post</button>}</div></td></tr>)}
      {tab === "expense" && tx.expenses.map((r) => <tr key={r.expenseId}><td>{r.expenseNumber}</td><td>{r.supplierId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td><div className="row-actions">{view("expense", r.expenseId)}{r.status === "DRAFT" && <button onClick={() => post("expense", r.expenseId)}>Post</button>}</div></td></tr>)}
    </tbody></table></section>
  </>;
}
