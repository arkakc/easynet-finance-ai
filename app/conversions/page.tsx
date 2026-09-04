"use client";

import { FormEvent, useEffect, useState } from "react";

type TxData = { quotes: any[]; purchaseOrders: any[] };

export default function ConversionsPage() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Transaction load failed");
      const tx = body as TxData & { ok: boolean };
      setQuotes((tx.quotes || []).filter((row: any) => String(row.status).toUpperCase() === "APPROVED"));
      setPos((tx.purchaseOrders || []).filter((row: any) => String(row.status).toUpperCase() === "APPROVED"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  async function convert(action: "quoteToInvoice" | "poToBill", payload: Record<string, FormDataEntryValue>) {
    const response = await fetch("/api/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action, payload }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Conversion failed");
    setMessage(`${action}: ${body.createdId} created.`);
    await load();
  }

  async function quoteToInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await convert("quoteToInvoice", Object.fromEntries(new FormData(event.currentTarget).entries())); event.currentTarget.reset(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Conversion failed"); }
  }

  async function poToBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await convert("poToBill", Object.fromEntries(new FormData(event.currentTarget).entries())); event.currentTarget.reset(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Conversion failed"); }
  }

  return (
    <>
      <h2>Document Conversions</h2>
      <p className="small">Only APPROVED quotations and purchase orders appear here. Converted accounting documents are created as DRAFT and still require Finance Controller posting.</p>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <form className="panel form-grid" onSubmit={quoteToInvoice}>
        <h3 className="form-title">Quotation → Sales Invoice</h3>
        <label>Approved Quotation<select name="quoteId" required defaultValue=""><option value="" disabled>Select quotation</option>{quotes.map((q) => <option key={q.quoteId} value={q.quoteId}>{q.quoteNumber} · {q.customerId} · K{Number(q.totalAmount || 0).toFixed(2)}</option>)}</select></label>
        <label>Invoice Number<input name="invoiceNumber" placeholder="Optional auto ID" /></label>
        <label>Invoice Date<input name="invoiceDate" type="date" required /></label>
        <label>Due Date<input name="dueDate" type="date" /></label>
        <label>Revenue Account<input name="revenueAccountId" defaultValue="ACC-4100" /></label>
        <div className="form-wide"><button type="submit">Convert to Invoice</button></div>
      </form>

      <form className="panel form-grid" onSubmit={poToBill}>
        <h3 className="form-title">Purchase Order → Supplier Bill</h3>
        <label>Approved Purchase Order<select name="poId" required defaultValue=""><option value="" disabled>Select PO</option>{pos.map((po) => <option key={po.poId} value={po.poId}>{po.poNumber} · {po.supplierId} · K{Number(po.totalAmount || 0).toFixed(2)}</option>)}</select></label>
        <label>Supplier Bill Number<input name="billNumber" placeholder="Supplier invoice number preferred" /></label>
        <label>Bill Date<input name="billDate" type="date" required /></label>
        <label>Due Date<input name="dueDate" type="date" /></label>
        <label>Cost Account<input name="costAccountId" defaultValue="ACC-5100" /></label>
        <div className="form-wide"><button type="submit">Convert to Supplier Bill</button></div>
      </form>
    </>
  );
}
