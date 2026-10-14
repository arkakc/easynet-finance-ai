"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ReturnRow = { invoiceId:string; invoiceNumber:string; originalInvoiceId:string; customerId:string; invoiceDate:string; status:string; totalAmount:number };
type ReturnableLine = { itemId:string; itemCode:string; itemName:string; itemType:string; uom:string; soldQty:number; alreadyReturnedQty:number; returnableQty:number; rate:number };
type InvoiceContext = { invoiceId:string; invoiceNumber:string; customerId:string; status:string; totalAmount:number; outstandingAmount:number };
type Readiness = { ok:boolean; error?:string; invoice?:InvoiceContext; lines?:ReturnableLine[]; existingCreditNotes?:Array<{invoiceId:string;invoiceNumber:string;totalAmount:number;status:string}> };
const money = (v:number) => new Intl.NumberFormat("en-PG",{style:"currency",currency:"PGK"}).format(v);
const today = () => new Date().toLocaleDateString("en-CA",{timeZone:"Pacific/Port_Moresby"});

export default function SalesReturnsClient(){
  const [mode,setMode] = useState<"list"|"create">("list");
  const [rows,setRows] = useState<ReturnRow[]>([]);
  const [busy,setBusy] = useState(false);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [search,setSearch] = useState("");
  const [invoiceId,setInvoiceId] = useState("");
  const [returnDate,setReturnDate] = useState(today);
  const [reason,setReason] = useState("");
  const [readiness,setReadiness] = useState<Readiness|null>(null);
  const [qty,setQty] = useState<Record<string,string>>({});
  const [created,setCreated] = useState<{invoiceId:string;invoiceNumber:string}|null>(null);

  const refresh = useCallback(async()=>{
    setBusy(true);
    try {
      const response = await fetch("/api/erp/sales-return",{cache:"no-store"});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to load returns");
      setRows(data.returns || []);
    } catch (e) { setError(e instanceof Error?e.message:"Failed to load returns"); }
    finally {setBusy(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const results=useMemo(()=>rows.filter(r=>[r.invoiceNumber,r.originalInvoiceId,r.customerId,r.status].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[rows,search]);
  const selected=useMemo(()=>(readiness?.lines||[]).filter(l=>Number(qty[l.itemId]||0)>0).map(l=>({itemId:l.itemId,qty:Number(qty[l.itemId])})),[readiness,qty]);
  const invalidSelection=selected.some(s=>!Number.isFinite(s.qty)||s.qty>(readiness?.lines?.find(l=>l.itemId===s.itemId)?.returnableQty||0)+0.0001);

  async function findInvoice(){
    setError("");setMessage("");setReadiness(null);setQty({});setCreated(null);
    if (!invoiceId.trim()){setError("Enter the original posted invoice ID.");return;}
    setBusy(true);
    try{
      const response=await fetch("/api/erp/sales-return?invoiceId="+encodeURIComponent(invoiceId.trim()),{cache:"no-store"});
      const data:Readiness=await response.json();
      if (!response.ok||!data.ok)throw new Error(data.error||"Invoice cannot be returned");
      setReadiness(data);
    }catch(e){setError(e instanceof Error?e.message:"Unable to load invoice");}
    finally{setBusy(false);}
  }
  async function saveDraft(){
    if(!readiness?.invoice||!selected.length||invalidSelection||reason.trim().length<8){setError("Select valid return quantities and enter a reason of at least 8 characters.");return;}
    if(!window.confirm("Create a draft credit note for the selected items? This does not approve, post, restock or refund the return."))return;
    setSaving(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/erp/sales-return",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({invoiceId:readiness.invoice.invoiceId,returnDate,reason:reason.trim(),lines:selected})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||"Unable to create draft credit note");
      setCreated({invoiceId:data.creditNote.invoiceId,invoiceNumber:data.creditNote.invoiceNumber});
      setMessage("Draft credit note created. Approval, warehouse receipt, posting and refund are separate controlled steps.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Unable to create draft");}
    finally{setSaving(false);}
  }

  return <div>
    <div className="page-head"><div><h2>Sales Returns</h2><p className="small">Invoice-linked full or partial returns and customer credit notes</p></div></div>
    <div className="ef-doctype-action-bar">
      <button type="button" className={mode==="list"?"ef-doctype-action active":"ef-doctype-action"} onClick={()=>{setMode("list");setError("");void refresh();}}>📋 View Existing Returns ({rows.length})</button>
      <button type="button" className={mode==="create"?"ef-doctype-action ef-doctype-create active":"ef-doctype-action ef-doctype-create"} onClick={()=>{setMode("create");setError("");}}>＋ Create Sales Return</button>
    </div>
    {error&&<div role="alert" className="ef-erp-action-feedback" data-tone="error">{error}</div>}
    {message&&<div role="status" className="ef-erp-action-feedback" data-tone="success">{message} {created&&<Link href={"/transactions/salesInvoice/"+encodeURIComponent(created.invoiceId)}>Open credit note</Link>}</div>}
    {mode==="list"?<section className="panel">
      <div className="form-title-row"><div><h3>Existing Sales Returns / Credit Notes</h3><p className="small">Credit notes are linked to their original sales invoice. Drafts are not yet posted.</p></div><button type="button" className="secondary" onClick={()=>void refresh()} disabled={busy}>Refresh</button></div>
      <label>Search returns <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Credit number, invoice ID, customer, status" /></label>
      <div className="table-wrap"><table><thead><tr><th>Credit Note</th><th>Original Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th>Amount (PGK)</th></tr></thead><tbody>
        {results.map(r=><tr key={r.invoiceId}><td><Link href={"/transactions/salesInvoice/"+encodeURIComponent(r.invoiceId)}>{r.invoiceNumber||r.invoiceId}</Link></td><td>{r.originalInvoiceId}</td><td>{r.customerId}</td><td>{r.invoiceDate}</td><td>{r.status}</td><td>{money(r.totalAmount)}</td></tr>)}
        {!results.length&&<tr><td colSpan={6}>{busy?"Loading…":"No sales returns found."}</td></tr>}
      </tbody></table></div>
      {rows.length>=500&&<p className="small">Showing up to 500 latest records from the current backend list limit.</p>}
    </section>:<section className="panel">
      <div className="form-title-row"><div><h3>Create Sales Return</h3><p className="small">Start from the original posted Sales Invoice. The return will create a draft credit note only.</p></div></div>
      <div className="form-grid">
        <label>Original Sales Invoice ID *<input value={invoiceId} onChange={e=>setInvoiceId(e.target.value)} placeholder="Enter invoice ID (not quotation/order)" disabled={busy||saving}/></label>
        <div className="button-row"><button type="button" onClick={()=>void findInvoice()} disabled={busy||saving||!invoiceId.trim()}>{busy?"Checking…":"Find Invoice & Returnable Items"}</button></div>
      </div>
      {readiness?.invoice&&<><div className="ef-erp-action-feedback" data-tone="success">Invoice: <strong>{readiness.invoice.invoiceNumber||readiness.invoice.invoiceId}</strong> · Customer: {readiness.invoice.customerId} · Status: {readiness.invoice.status} · Invoice total: {money(readiness.invoice.totalAmount)}</div>
        <div className="table-wrap"><table><thead><tr><th>Item</th><th>Type</th><th>Sold</th><th>Already returned</th><th>Available</th><th>Unit rate</th><th>Return qty *</th></tr></thead><tbody>
          {(readiness.lines||[]).map(l=><tr key={l.itemId}><td>{l.itemName} ({l.itemCode})</td><td>{l.itemType}</td><td>{l.soldQty}</td><td>{l.alreadyReturnedQty}</td><td>{l.returnableQty}</td><td>{money(l.rate)}</td><td><input style={{width:110}} type="number" min="0" max={l.returnableQty} step="any" aria-label={"Return quantity for "+l.itemName} value={qty[l.itemId]||""} disabled={saving||Boolean(created)} onChange={e=>setQty(old=>({...old,[l.itemId]:e.target.value}))}/></td></tr>)}
          {!readiness.lines?.length&&<tr><td colSpan={7}>No remaining returnable items.</td></tr>}
        </tbody></table></div>
        <div className="form-grid"><label>Return date *<input type="date" value={returnDate} onChange={e=>setReturnDate(e.target.value)} disabled={saving||Boolean(created)}/></label><label>Return reason * (minimum 8 characters)<textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} disabled={saving||Boolean(created)} placeholder="Describe why the customer is returning these items"/></label></div>
        <div className="ef-erp-action-feedback" data-tone="warning">Creating a draft does not approve the return, receive stock, post to GL/GST or pay a refund. These actions require separate authorized workflows.</div>
        <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={saving||Boolean(created)||!selected.length||invalidSelection||reason.trim().length<8||!returnDate} onClick={()=>void saveDraft()}>{saving?"Saving…":"Save Draft Credit Note"}</button></div>
      </>}
    </section>}
  </div>;
}
