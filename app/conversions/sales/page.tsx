"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Quote = { quoteId:string; quoteNumber:string; customerId:string; projectId?:string; totalAmount?:number|string; status?:string };
type Invoice = { invoiceId:string; invoiceNumber:string; customerId:string; projectId?:string; totalAmount?:number|string; outstandingAmount?:number|string; status?:string };

type TxData = { ok:boolean; quotes?:Quote[]; invoices?:Invoice[]; error?:string };

function localDate(plusDays=0){const d=new Date();d.setDate(d.getDate()+plusDays);const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;}

export default function SalesConversionsPage(){
  const router=useRouter();
  const [quotes,setQuotes]=useState<Quote[]>([]);
  const [invoices,setInvoices]=useState<Invoice[]>([]);
  const [selectedInvoiceId,setSelectedInvoiceId]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function load(){
    try{
      const response=await fetch("/api/erp/transactions");
      const body=await response.json() as TxData;
      if(!response.ok||!body.ok) throw new Error(body.error||"Transaction load failed");
      setQuotes((body.quotes||[]).filter(row=>["APPROVED","CONVERTED"].includes(String(row.status||"").toUpperCase())));
      setInvoices((body.invoices||[]).filter(row=>!["CANCELLED","CANCELED"].includes(String(row.status||"").toUpperCase())));
    }catch(error){setMessage(error instanceof Error?error.message:"Load failed");}
  }

  useEffect(()=>{void load();},[]);
  const selectedInvoice=useMemo(()=>invoices.find(row=>row.invoiceId===selectedInvoiceId),[invoices,selectedInvoiceId]);

  async function quoteToInvoice(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const payload=Object.fromEntries(new FormData(event.currentTarget).entries());
      const response=await fetch("/api/erp/conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"quoteToInvoice",payload})});
      const body=await response.json();
      if(!response.ok||!body.ok) throw new Error(body.error||"Conversion failed");
      router.push(`/transactions/invoice/${body.createdId}`);router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Conversion failed");}finally{setBusy(false);}
  }

  async function invoiceToReceipt(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const f=new FormData(event.currentTarget);
      const invoice=invoices.find(row=>row.invoiceId===String(f.get("invoiceId")||""));
      if(!invoice) throw new Error("Select a Sales Invoice");
      const amount=Number(f.get("amount")||0);
      if(!(amount>0)) throw new Error("Receipt amount must be greater than zero");
      const response=await fetch("/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createPayment",payload:{paymentNumber:"",paymentType:"RECEIVE",partyType:"Customer",partyId:invoice.customerId,projectId:invoice.projectId||"",paymentDate:f.get("paymentDate"),amount,paymentMethod:f.get("paymentMethod"),cashBankAccountId:f.get("cashBankAccountId"),againstDocumentType:"Sales Invoice",againstDocumentId:invoice.invoiceId,reference:f.get("reference")||""}})});
      const body=await response.json();
      if(!response.ok||!body.ok) throw new Error(body.error||"Receipt creation failed");
      router.push(`/transactions/payment/${body.result.recordId}`);router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Receipt creation failed");}finally{setBusy(false);}
  }

  return <>
    <div className="page-heading"><div><h2>Sales Document Conversions</h2><p className="small">Sales Quotation → Sales Invoice → Sales Payment Entry / Receipt.</p></div></div>
    {message&&<section className="panel"><strong>Status:</strong> {message}</section>}

    <form className="panel form-grid" onSubmit={quoteToInvoice}>
      <h3 className="form-title">Sales Quotation → Sales Invoice</h3>
      <label>Approved Sales Quotation<select name="quoteId" required defaultValue=""><option value="" disabled>Select Sales Quotation</option>{quotes.map(q=><option key={q.quoteId} value={q.quoteId}>{q.quoteNumber} · {q.customerId} · K{Number(q.totalAmount||0).toFixed(2)}</option>)}</select></label>
      <label>Invoice Number<input name="invoiceNumber" placeholder="Leave blank for automatic numbering" /></label>
      <label>Invoice Date<input name="invoiceDate" type="date" required defaultValue={localDate()} /></label>
      <label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} /></label>
      <label>Revenue Account<input name="revenueAccountId" defaultValue="ACC-4100" /></label>
      <div className="form-wide"><button type="submit" disabled={busy}>Create Sales Invoice</button></div>
    </form>

    <form className="panel form-grid" onSubmit={invoiceToReceipt}>
      <h3 className="form-title">Sales Invoice → Sales Payment Entry / Receipt</h3>
      <label>Sales Invoice<select name="invoiceId" required value={selectedInvoiceId} onChange={e=>setSelectedInvoiceId(e.target.value)}><option value="" disabled>Select Sales Invoice</option>{invoices.map(inv=><option key={inv.invoiceId} value={inv.invoiceId}>{inv.invoiceNumber} · {inv.customerId} · Outstanding K{Number(inv.outstandingAmount??inv.totalAmount??0).toFixed(2)}</option>)}</select></label>
      <label>Receipt Date<input name="paymentDate" type="date" required defaultValue={localDate()} /></label>
      <label>Amount<input key={selectedInvoiceId||"none"} name="amount" type="number" min="0.01" step="0.01" required defaultValue={selectedInvoice?Number(selectedInvoice.outstandingAmount??selectedInvoice.totalAmount??0):undefined} /></label>
      <label>Method<select name="paymentMethod" defaultValue="Bank Transfer"><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label>
      <label className="form-wide">Reference<input name="reference" placeholder="Bank ref / receipt ref" /></label>
      <div className="form-wide"><button type="submit" disabled={busy}>Create Sales Receipt</button></div>
    </form>
  </>;
}
