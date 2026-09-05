"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Master = { customers: any[]; suppliers: any[]; projects: any[] };
type TxData = { quotes: any[]; purchaseOrders: any[]; invoices: any[]; supplierBills: any[]; payments: any[]; expenses: any[] };
type CommercialType = "quote" | "invoice" | "purchaseOrder" | "supplierBill";
type Tab = CommercialType | "payment" | "expense";
type DraftLine = { description: string; qty: string; uom: string; rate: string };

const emptyMaster: Master = { customers: [], suppliers: [], projects: [] };
const emptyTx: TxData = { quotes: [], purchaseOrders: [], invoices: [], supplierBills: [], payments: [], expenses: [] };
const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

export default function TransactionsPage() {
  const [tab, setTab] = useState<Tab>("invoice");
  const [secret, setSecret] = useState("");
  const [masters, setMasters] = useState<Master>(emptyMaster);
  const [tx, setTx] = useState<TxData>(emptyTx);
  const [status, setStatus] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", qty: "1", uom: "Each", rate: "0" }]);

  async function load() {
    try {
      const [m, t] = await Promise.all([
        fetch("/api/masters", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/transactions", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!m.ok) throw new Error(m.error || "Master-data load failed");
      if (!t.ok) throw new Error(t.error || "Transaction load failed");
      setMasters({ customers: m.customers || [], suppliers: m.suppliers || [], projects: m.projects || [] });
      setTx({
        quotes: t.quotes || [], purchaseOrders: t.purchaseOrders || [], invoices: t.invoices || [],
        supplierBills: t.supplierBills || [], payments: t.payments || [], expenses: t.expenses || [],
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  const isSales = tab === "quote" || tab === "invoice";
  const commercial = ["quote", "invoice", "purchaseOrder", "supplierBill"].includes(tab);
  const partyOptions = useMemo(() => isSales ? masters.customers : masters.suppliers, [isSales, masters]);

  function setLine(index: number, field: keyof DraftLine, value: string) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  function addLine() {
    setLines((current) => [...current, { description: "", qty: "1", uom: "Each", rate: "0" }]);
  }

  function removeLine(index: number) {
    setLines((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));
  }

  async function call(action: string, payload: unknown) {
    setStatus("Saving...");
    const response = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action, payload }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Transaction failed");
    setStatus(JSON.stringify(body.result, null, 2));
    await load();
    return body.result;
  }

  async function submitCommercial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    try {
      const f = new FormData(formElement);
      const payload = {
        documentNumber: f.get("documentNumber"),
        partyId: f.get("partyId"),
        projectId: f.get("projectId"),
        documentDate: f.get("documentDate"),
        dueDate: f.get("dueDate"),
        expiryDate: f.get("expiryDate"),
        gstRate: Number(f.get("gstRate") || 0) / 100,
        accountId: f.get("accountId"),
        poId: f.get("poId"),
        lines: lines.map((line) => ({ ...line, qty: Number(line.qty), rate: Number(line.rate) })),
      };
      const action = tab === "quote" ? "createQuote" : tab === "invoice" ? "createInvoice" : tab === "purchaseOrder" ? "createPurchaseOrder" : "createSupplierBill";
      await call(action, payload);
      formElement.reset();
      setLines([{ description: "", qty: "1", uom: "Each", rate: "0" }]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    try {
      const f = new FormData(formElement);
      await call("createPayment", Object.fromEntries(f.entries()));
      formElement.reset();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    try {
      const f = new FormData(formElement);
      await call("createExpense", Object.fromEntries(f.entries()));
      formElement.reset();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); }
  }

  async function post(recordType: "invoice" | "supplierBill" | "payment" | "expense", recordId: string) {
    try { await call("post", { recordType, recordId }); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Post failed"); }
  }

  const tabButton = (value: Tab, label: string) => (
    <button key={value} className={tab === value ? "tab active" : "tab"} onClick={() => setTab(value)}>{label}</button>
  );

  return (
    <>
      <h2>Transactions</h2>
      <p className="small">Create commercial documents as drafts, then post accounting documents only after Finance Controller review.</p>

      <section className="panel">
        <label>APP_SECRET for create/post actions<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label>
      </section>

      <div className="tabs wrap-tabs">
        {tabButton("quote", "Quotation")}
        {tabButton("invoice", "Sales Invoice")}
        {tabButton("purchaseOrder", "Purchase Order")}
        {tabButton("supplierBill", "Supplier Bill")}
        {tabButton("payment", "Payment / Receipt")}
        {tabButton("expense", "Expense")}
      </div>

      {status && <section className="panel"><strong>Status</strong><pre className="status-pre">{status}</pre></section>}

      {commercial && (
        <form className="panel" onSubmit={submitCommercial}>
          <h3>{tab === "quote" ? "New Quotation" : tab === "invoice" ? "New Sales Invoice" : tab === "purchaseOrder" ? "New Purchase Order" : "New Supplier Bill"}</h3>
          <div className="form-grid">
            <label>Document Number<input name="documentNumber" placeholder="Optional auto number" /></label>
            <label>{isSales ? "Customer" : "Supplier"}
              <select name="partyId" required defaultValue=""><option value="" disabled>Select</option>{partyOptions.map((p) => <option key={p.customerId || p.supplierId} value={p.customerId || p.supplierId}>{p.customerName || p.supplierName}</option>)}</select>
            </label>
            <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{masters.projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName} ({p.projectId})</option>)}</select></label>
            <label>Date<input name="documentDate" type="date" required /></label>
            {(tab === "invoice" || tab === "supplierBill") && <label>Due Date<input name="dueDate" type="date" /></label>}
            {tab === "quote" && <label>Expiry Date<input name="expiryDate" type="date" /></label>}
            <label>GST %<input name="gstRate" type="number" min="0" max="100" step="0.01" defaultValue="0" /></label>
            {(tab === "invoice" || tab === "supplierBill") && <label>{tab === "invoice" ? "Revenue Account" : "Cost Account"}<input name="accountId" placeholder={tab === "invoice" ? "ACC-4100" : "ACC-5100"} /></label>}
            {tab === "supplierBill" && <label>Against PO ID<input name="poId" placeholder="Optional" /></label>}
          </div>

          <h4>Lines</h4>
          {lines.map((line, index) => (
            <div className="line-grid" key={index}>
              <input placeholder="Description" value={line.description} onChange={(e) => setLine(index, "description", e.target.value)} required />
              <input type="number" min="0.0001" step="0.0001" value={line.qty} onChange={(e) => setLine(index, "qty", e.target.value)} />
              <input placeholder="UOM" value={line.uom} onChange={(e) => setLine(index, "uom", e.target.value)} />
              <input type="number" min="0" step="0.01" value={line.rate} onChange={(e) => setLine(index, "rate", e.target.value)} />
              <button type="button" className="secondary" onClick={() => removeLine(index)}>Remove</button>
            </div>
          ))}
          <div className="button-row"><button type="button" className="secondary" onClick={addLine}>Add Line</button><button type="submit">Save Draft</button></div>
        </form>
      )}

      {tab === "payment" && (
        <form className="panel form-grid" onSubmit={submitPayment}>
          <h3 className="form-title">New Payment / Receipt</h3>
          <label>Number<input name="paymentNumber" /></label>
          <label>Type<select name="paymentType" defaultValue="RECEIVE"><option value="RECEIVE">Customer Receipt</option><option value="PAY">Supplier Payment</option></select></label>
          <label>Party Type<select name="partyType" defaultValue="Customer"><option>Customer</option><option>Supplier</option></select></label>
          <label>Party ID<input name="partyId" required placeholder="CUS... or SUP..." /></label>
          <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{masters.projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label>
          <label>Date<input name="paymentDate" type="date" required /></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Method<select name="paymentMethod"><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
          <label>Cash/Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label>
          <label>Against Type<input name="againstDocumentType" placeholder="Sales Invoice / Supplier Bill" /></label>
          <label>Against Record ID<input name="againstDocumentId" placeholder="INV... / BILL..." /></label>
          <label className="form-wide">Reference<input name="reference" /></label>
          <div className="form-wide"><button type="submit">Save Draft</button></div>
        </form>
      )}

      {tab === "expense" && (
        <form className="panel form-grid" onSubmit={submitExpense}>
          <h3 className="form-title">New Expense</h3>
          <label>Expense Number<input name="expenseNumber" /></label>
          <label>Date<input name="expenseDate" type="date" required /></label>
          <label>Supplier ID<input name="supplierId" /></label>
          <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{masters.projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label>
          <label>Expense Account<input name="expenseAccountId" defaultValue="ACC-6600" required /></label>
          <label>Net Amount<input name="netAmount" type="number" min="0" step="0.01" required /></label>
          <label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Payment Method<select name="paymentMethod"><option>Cash</option><option>Bank Transfer</option><option>Card</option></select></label>
          <label>Cash/Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label>
          <label className="form-wide">Description<input name="description" required /></label>
          <div className="form-wide"><button type="submit">Save Draft</button></div>
        </form>
      )}

      <section className="panel table-wrap">
        <h3>Current {tab}</h3>
        <table className="data-table">
          <thead><tr><th>ID / Number</th><th>Party / Project</th><th>Total / Amount</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {tab === "quote" && tx.quotes.map((r) => <tr key={r.quoteId}><td>{r.quoteNumber}<br/><span className="small">{r.quoteId}</span></td><td>{r.customerId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td>Non-GL</td></tr>)}
            {tab === "purchaseOrder" && tx.purchaseOrders.map((r) => <tr key={r.poId}><td>{r.poNumber}<br/><span className="small">{r.poId}</span></td><td>{r.supplierId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td>Non-GL</td></tr>)}
            {tab === "invoice" && tx.invoices.map((r) => <tr key={r.invoiceId}><td>{r.invoiceNumber}<br/><span className="small">{r.invoiceId}</span></td><td>{r.customerId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}<br/><span className="small">Outstanding {money(r.outstandingAmount)}</span></td><td>{r.status}</td><td>{r.status === "DRAFT" ? <button onClick={() => post("invoice", r.invoiceId)}>Post</button> : r.journalId || "Posted"}</td></tr>)}
            {tab === "supplierBill" && tx.supplierBills.map((r) => <tr key={r.billId}><td>{r.billNumber}<br/><span className="small">{r.billId}</span></td><td>{r.supplierId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}<br/><span className="small">Outstanding {money(r.outstandingAmount)}</span></td><td>{r.status}</td><td>{r.status === "DRAFT" ? <button onClick={() => post("supplierBill", r.billId)}>Post</button> : r.journalId || "Posted"}</td></tr>)}
            {tab === "payment" && tx.payments.map((r) => <tr key={r.paymentId}><td>{r.paymentNumber}<br/><span className="small">{r.paymentId}</span></td><td>{r.partyType}: {r.partyId}<br/>{r.projectId}</td><td>{money(r.amount)}</td><td>{r.status}</td><td>{r.status === "DRAFT" ? <button onClick={() => post("payment", r.paymentId)}>Post</button> : r.journalId || "Posted"}</td></tr>)}
            {tab === "expense" && tx.expenses.map((r) => <tr key={r.expenseId}><td>{r.expenseNumber}<br/><span className="small">{r.expenseId}</span></td><td>{r.supplierId}<br/>{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td>{r.status === "DRAFT" ? <button onClick={() => post("expense", r.expenseId)}>Post</button> : r.journalId || "Posted"}</td></tr>)}
          </tbody>
        </table>
      </section>
    </>
  );
}
