"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TxData = { quotes: any[]; purchaseOrders: any[] };

function localDate(plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function ConversionsPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/erp/transactions");
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Transaction load failed");
      const tx = body as TxData & { ok: boolean };
      setQuotes((tx.quotes || []).filter((row: any) => ["APPROVED", "CONVERTED"].includes(String(row.status).toUpperCase())));
      setPos((tx.purchaseOrders || []).filter((row: any) => ["APPROVED", "BILL_CREATED", "BILLED"].includes(String(row.status).toUpperCase())));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  async function convert(action: "quoteToInvoice" | "poToBill", payload: Record<string, FormDataEntryValue>) {
    const response = await fetch("/api/erp/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Conversion failed");
    const targetType = action === "quoteToInvoice" ? "invoice" : "supplierBill";
    router.push(`/transactions/${targetType}/${body.createdId}`);
    router.refresh();
  }

  async function quoteToInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await convert("quoteToInvoice", Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Conversion failed"); }
  }

  async function poToBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await convert("poToBill", Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Conversion failed"); }
  }

  return (
    <>
      <h2>Document Conversions</h2>
      <p className="small">Approved source documents are mapped into linked draft documents. Authentication and role permissions are enforced server-side.</p>
      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <form className="panel form-grid" onSubmit={quoteToInvoice}>
        <h3 className="form-title">Quotation → Sales Invoice</h3>
        <label>Approved Quotation<select name="quoteId" required defaultValue=""><option value="" disabled>Select quotation</option>{quotes.map((q) => <option key={q.quoteId} value={q.quoteId}>{q.quoteNumber} · {q.customerId} · K{Number(q.totalAmount || 0).toFixed(2)}</option>)}</select></label>
        <label>Invoice Number<input name="invoiceNumber" placeholder="Leave blank for automatic numbering" /></label>
        <label>Invoice Date<input name="invoiceDate" type="date" required defaultValue={localDate()} /></label>
        <label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} /></label>
        <label>Revenue Account<input name="revenueAccountId" defaultValue="ACC-4100" /></label>
        <div className="form-wide"><button type="submit">Create Draft Invoice</button></div>
      </form>

      <form className="panel form-grid" onSubmit={poToBill}>
        <h3 className="form-title">Purchase Order → Supplier Bill</h3>
        <label>Approved Purchase Order<select name="poId" required defaultValue=""><option value="" disabled>Select PO</option>{pos.map((po) => <option key={po.poId} value={po.poId}>{po.poNumber} · {po.supplierId} · K{Number(po.totalAmount || 0).toFixed(2)}</option>)}</select></label>
        <label>Supplier Bill Number<input name="billNumber" placeholder="Supplier invoice no. or blank" /></label>
        <label>Bill Date<input name="billDate" type="date" required defaultValue={localDate()} /></label>
        <label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} /></label>
        <label>Cost Account<input name="costAccountId" defaultValue="ACC-5100" /></label>
        <div className="form-wide"><button type="submit">Create Draft Supplier Bill</button></div>
      </form>
    </>
  );
}
