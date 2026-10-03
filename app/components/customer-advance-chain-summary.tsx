"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Context="quote"|"order"|"invoice"|"payment";
type Props={
  context:Context;
  sourceQuoteId:string;
  customerId:string;
  quoteTotal?:number;
  invoiceId?:string;
  invoiceNumber?:string;
  invoiceOutstanding?:number;
  invoiceTotal?:number;
  paymentId?:string;
};
type Payment={paymentId:string;paymentNumber?:string;paymentType?:string;partyType?:string;partyId?:string;amount?:number|string;status?:string;journalId?:string;againstDocumentId?:string;againstDocumentType?:string;createdAt?:string};
type Invoice={invoiceId:string;invoiceNumber?:string;sourceDocumentId?:string;sourceQuoteId?:string;totalAmount?:number|string;outstandingAmount?:number|string;status?:string};
type Quote={quoteId:string;quoteNumber?:string;totalAmount?:number|string;status?:string};
type Summary={allocatedAmount:number;remainingAmount:number;allocations:Array<{milestone?:string;againstDocumentId?:string;againstDocumentNumber?:string;amount?:number|string}>};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
const createdValue=(row:Payment)=>{const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;};

export default function CustomerAdvanceChainSummary(props:Props){
  const[payments,setPayments]=useState<Payment[]>([]);
  const[settlementReceipts,setSettlementReceipts]=useState<Payment[]>([]);
  const[summaries,setSummaries]=useState<Record<string,Summary>>({});
  const[invoices,setInvoices]=useState<Invoice[]>([]);
  const[quote,setQuote]=useState<Quote|null>(null);
  const[loading,setLoading]=useState(true);
  const[message,setMessage]=useState("");

  useEffect(()=>{let active=true;void(async()=>{setLoading(true);try{
    const[paymentsResponse,transactionsResponse]=await Promise.all([
      fetch(`/api/erp/source-payments?sourceDocumentId=${encodeURIComponent(props.sourceQuoteId)}&partyType=Customer&partyId=${encodeURIComponent(props.customerId)}`,{cache:"no-store"}),
      fetch("/api/erp/transactions",{cache:"no-store"})
    ]);
    const[paymentsBody,transactionsBody]=await Promise.all([paymentsResponse.json(),transactionsResponse.json()]);
    if(!paymentsResponse.ok||!paymentsBody.ok)throw new Error(paymentsBody.error||"Customer advance chain load failed");
    if(!transactionsResponse.ok||!transactionsBody.ok)throw new Error(transactionsBody.error||"Sales document links load failed");
    if(!active)return;
    const linked=((paymentsBody.payments||[]) as Payment[]).filter(row=>!["CANCELLED","REVERSED"].includes(String(row.status||"").toUpperCase()));
    setPayments(linked.filter(row=>!String(row.againstDocumentId||"").trim()));
    const invoiceRefs=new Set([props.invoiceId,props.invoiceNumber].map(value=>String(value||"").trim()).filter(Boolean));
    const directReceipts=props.invoiceId?((transactionsBody.payments||[]) as Payment[]).filter(row=>String(row.partyType||"")==="Customer"&&String(row.paymentType||"").toUpperCase()==="RECEIVE"&&String(row.partyId||"")===props.customerId&&Boolean(String(row.journalId||"").trim())&&["POSTED","CLEARED"].includes(String(row.status||"").toUpperCase())&&invoiceRefs.has(String(row.againstDocumentId||"").trim())):[];
    setSettlementReceipts(directReceipts);
    setInvoices(((transactionsBody.invoices||[]) as Invoice[]).filter(row=>String(row.sourceQuoteId||"")===props.sourceQuoteId||String(row.sourceDocumentId||"")===props.sourceQuoteId));
    setQuote(((transactionsBody.quotes||[]) as Quote[]).find(row=>String(row.quoteId||"")===props.sourceQuoteId)||null);
    const posted=linked.filter(row=>String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId));
    const next:Record<string,Summary>={};
    await Promise.all(posted.map(async(row)=>{try{
      const response=await fetch(`/api/erp/advance-allocation?paymentId=${encodeURIComponent(row.paymentId)}`,{cache:"no-store"});
      const body=await response.json();
      if(response.ok&&body.ok)next[row.paymentId]=body.summary;
    }catch{}}));
    if(active)setSummaries(next);
  }catch(error){if(active)setMessage(error instanceof Error?error.message:"Customer advance chain load failed");}
  finally{if(active)setLoading(false);}})();return()=>{active=false;};},[props.sourceQuoteId,props.customerId]);

  const posted=useMemo(()=>payments.filter(row=>String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId)),[payments]);
  const advanceCreated=useMemo(()=>payments.reduce((sum,row)=>sum+Number(row.amount||0),0),[payments]);
  const advancePosted=useMemo(()=>posted.reduce((sum,row)=>sum+Number(row.amount||0),0),[posted]);
  const advanceAllocated=useMemo(()=>posted.reduce((sum,row)=>sum+Number(summaries[row.paymentId]?.allocatedAmount||0),0),[posted,summaries]);
  const advanceAvailable=useMemo(()=>posted.reduce((sum,row)=>sum+Number(summaries[row.paymentId]?.remainingAmount??row.amount??0),0),[posted,summaries]);
  const quoteTotal=Number(props.quoteTotal??quote?.totalAmount??0);
  const quoteRemaining=Math.max(0,quoteTotal-advancePosted);
  const thisInvoiceAdvance=props.invoiceId?posted.reduce((sum,row)=>sum+(summaries[row.paymentId]?.allocations||[]).filter(a=>String(a.againstDocumentId||a.milestone||"")===props.invoiceId).reduce((s,a)=>s+Number(a.amount||0),0),0):0;
  const currentPayment=props.paymentId?payments.find(row=>row.paymentId===props.paymentId)||null:null;
  const currentSummary=currentPayment?summaries[currentPayment.paymentId]||null:null;
  const normalCustomerReceipts=useMemo(()=>settlementReceipts.reduce((sum,row)=>sum+Number(row.amount||0),0),[settlementReceipts]);
  const invoiceTotal=Number(props.invoiceTotal||0),invoiceOutstanding=Number(props.invoiceOutstanding||0);
  const totalSettled=props.invoiceId?Math.max(0,invoiceTotal-invoiceOutstanding):0;
  if(!loading&&payments.length===0&&settlementReceipts.length===0&&props.context!=="invoice")return null;

  return <section className="panel no-print" style={{marginTop:20}}>
    <div className="form-title-row">
      <div>
        <h3>{props.context==="invoice"?"Sales Invoice Settlement Summary":"Customer Advance Receipt Status"}</h3>
        <p className="small">{props.context==="invoice"?"Shows customer advance adjustments, posted receipts, total settled and the remaining invoice balance.":"Tracks customer advances from Sales Quotation through Sales Invoice allocation. Unused advance remains available for later invoices from the same quotation."}</p>
      </div>
      <span className="auto-badge">{loading?"Loading…":props.context==="invoice"?`Settled ${money(totalSettled)}`:`Customer Advance ${money(advancePosted)}`}</span>
    </div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
    {!loading&&<>
      <div className="document-meta" style={{marginTop:14}}>
        <div><span>Sales Quotation</span><strong><Link prefetch={false} href={`/transactions/quote/${encodeURIComponent(props.sourceQuoteId)}`}>{quote?.quoteNumber||props.sourceQuoteId}</Link></strong></div>
        <div><span>Quotation Total</span><strong>{money(quoteTotal)}</strong></div>
        <div><span>Advance Created</span><strong>{money(advanceCreated)}</strong></div>
        <div><span>Advance Finalized / Received</span><strong>{money(advancePosted)}</strong></div>
        <div><span>Advance Adjusted to Invoice(s)</span><strong>{money(advanceAllocated)}</strong></div>
        <div><span>Unallocated Advance Remaining</span><strong>{money(advanceAvailable)}</strong></div>
        <div><span>Quotation Value Remaining After Advance</span><strong>{money(quoteRemaining)}</strong></div>
        {props.invoiceId&&<div><span>Invoice Total</span><strong>{money(invoiceTotal)}</strong></div>}
        {props.invoiceId&&<div><span>Advance Settled</span><strong>{money(thisInvoiceAdvance)}</strong></div>}
        {props.invoiceId&&<div><span>Customer Receipts Settled</span><strong>{money(normalCustomerReceipts)}</strong></div>}
        {props.invoiceId&&<div><span>Total Settled / Received</span><strong>{money(totalSettled)}</strong></div>}
        {props.invoiceId&&<div><span>This Invoice Outstanding</span><strong>{money(invoiceOutstanding)}</strong></div>}
        {currentPayment&&<div><span>This Advance Receipt</span><strong>{money(currentPayment.amount)}</strong></div>}
        {currentSummary&&<div><span>This Receipt Allocated</span><strong>{money(currentSummary.allocatedAmount)}</strong></div>}
        {currentSummary&&<div><span>This Receipt Remaining</span><strong>{money(currentSummary.remainingAmount)}</strong></div>}
      </div>
      {props.context==="invoice"&&settlementReceipts.length>0&&(
        <div className="table-wrap" style={{marginTop:18}}>
          <div className="form-title-row"><div><strong>Customer Receipt History</strong><p className="small">Every finalized receipt against this Sales Invoice is retained as a separate accounting document.</p></div><span className="auto-badge">{settlementReceipts.length+posted.length} Receipt{settlementReceipts.length+posted.length===1?"":"s"}</span></div>
          <table className="data-table" style={{marginTop:12}}>
            <thead><tr><th>Receipt Entry</th><th>Created</th><th>Amount</th><th>Status</th><th>Allocated</th><th>Remaining</th><th>Adjusted Against</th></tr></thead>
            <tbody>{[...settlementReceipts].sort((a,b)=>createdValue(b)-createdValue(a)).map(row=><tr key={row.paymentId}>
              <td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}>{row.paymentNumber||row.paymentId}</Link></td>
              <td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td>
              <td>{money(row.amount)}</td>
              <td>{row.status||"POSTED"}</td>
              <td>{money(row.amount)}</td>
              <td>{money(0)}</td>
              <td>{props.invoiceId?<Link prefetch={false} href={`/transactions/invoice/${encodeURIComponent(props.invoiceId)}`}>{props.invoiceNumber||props.invoiceId}</Link>:"—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {props.context==="payment"?(
        <div className="table-wrap" style={{marginTop:18}}>
          <table className="data-table">
            <thead><tr><th>Sales Quotation</th><th>Status</th><th>Quotation Total</th><th>Advance Finalized</th><th>Advance Allocated</th><th>Advance Remaining</th><th>Adjusted Against</th></tr></thead>
            <tbody><tr>
              <td><Link prefetch={false} href={`/transactions/quote/${encodeURIComponent(props.sourceQuoteId)}`}><strong>{quote?.quoteNumber||props.sourceQuoteId}</strong></Link></td>
              <td>{quote?.status||"—"}</td>
              <td>{money(quoteTotal)}</td>
              <td>{money(advancePosted)}</td>
              <td>{money(advanceAllocated)}</td>
              <td>{money(advanceAvailable)}</td>
              <td>{(()=>{
                const allocations=posted.flatMap(row=>(summaries[row.paymentId]?.allocations||[]).map(a=>({id:String(a.againstDocumentId||a.milestone||""),number:String(a.againstDocumentNumber||"")}))).filter(a=>a.id);
                const unique=[...new Map(allocations.map(a=>[a.id,a])).values()];
                return unique.length?unique.map((allocation,index)=>{const invoice=invoices.find(row=>String(row.invoiceId||"")===allocation.id);return <span key={allocation.id}>{index?", ":""}<Link href={`/transactions/invoice/${encodeURIComponent(allocation.id)}`}>{allocation.number||invoice?.invoiceNumber||allocation.id}</Link></span>;}):"Unallocated";
              })()}</td>
            </tr></tbody>
          </table>
        </div>
      ):payments.length>0?(
        <div className="table-wrap" style={{marginTop:18}}>
          <table className="data-table">
            <thead><tr><th>Advance Receipt</th><th>Created</th><th>Amount</th><th>Status</th><th>Allocated</th><th>Remaining</th><th>Adjusted Against</th></tr></thead>
            <tbody>{[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map(row=>{const summary=summaries[row.paymentId];const allocations=(summary?.allocations||[]).map(a=>({id:String(a.againstDocumentId||a.milestone||""),number:String(a.againstDocumentNumber||"")})).filter(a=>a.id);const unique=[...new Map(allocations.map(a=>[a.id,a])).values()];return <tr key={row.paymentId}>
              <td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}>{row.paymentNumber||row.paymentId}</Link></td>
              <td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td>
              <td>{money(row.amount)}</td><td>{row.status||"DRAFT"}</td><td>{summary?money(summary.allocatedAmount):"—"}</td><td>{summary?money(summary.remainingAmount):"—"}</td>
              <td>{unique.length?unique.map((allocation,index)=>{const invoice=invoices.find(row=>String(row.invoiceId||"")===allocation.id);return <span key={allocation.id}>{index?", ":""}<Link href={`/transactions/invoice/${encodeURIComponent(allocation.id)}`}>{allocation.number||invoice?.invoiceNumber||allocation.id}</Link></span>}):"Unallocated"}</td>
            </tr>})}</tbody>
          </table>
        </div>
      ):null}
    </>}
  </section>;
}
