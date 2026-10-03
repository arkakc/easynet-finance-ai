"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Context="po"|"invoice"|"payment";
type Props={context:Context;poId:string;supplierId:string;poTotal?:number;billId?:string;billNumber?:string;billTotal?:number;billOutstanding?:number;paymentId?:string};
type Payment={paymentId:string;paymentNumber?:string;paymentType?:string;partyType?:string;partyId?:string;amount?:number|string;status?:string;journalId?:string;reference?:string;sourceDocumentId?:string;againstDocumentId?:string;againstDocumentType?:string;createdAt?:string};
type SupplierBill={billId:string;billNumber?:string;poId?:string;sourceDocumentId?:string;totalAmount?:number|string;outstandingAmount?:number|string;status?:string};
type PurchaseOrder={poId:string;poNumber?:string;totalAmount?:number|string;status?:string};
type Summary={allocatedAmount:number;remainingAmount:number;allocations:Array<{milestone?:string;againstDocumentId?:string;againstDocumentNumber?:string;amount?:number|string}>};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
const createdValue=(row:Payment)=>{const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;};

export default function SupplierAdvanceChainSummary(props:Props){
  const[payments,setPayments]=useState<Payment[]>([]),[settlementPayments,setSettlementPayments]=useState<Payment[]>([]),[summaries,setSummaries]=useState<Record<string,Summary>>({}),[bills,setBills]=useState<SupplierBill[]>([]),[po,setPo]=useState<PurchaseOrder|null>(null),[loading,setLoading]=useState(true),[message,setMessage]=useState("");
  const marker=`PO:${props.poId}|`;
  useEffect(()=>{let active=true;void(async()=>{setLoading(true);try{const response=await fetch("/api/erp/transactions",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance chain load failed");if(!active)return;const allPayments=(body.payments||[]) as Payment[];const linked=allPayments.filter((row:Payment)=>String(row.partyType||"")==="Supplier"&&String(row.paymentType||"").toUpperCase()==="PAY"&&String(row.partyId||"")===props.supplierId&&!['CANCELLED','REVERSED'].includes(String(row.status||"").toUpperCase())&&(String(row.sourceDocumentId||"")===props.poId||String(row.reference||"").startsWith(marker))&&!String(row.againstDocumentId||"").trim());setPayments(linked);const billRefs=new Set([props.billId,props.billNumber].map(value=>String(value||"").trim()).filter(Boolean));const directSettlements=props.billId?allPayments.filter((row:Payment)=>String(row.partyType||"")==="Supplier"&&String(row.paymentType||"").toUpperCase()==="PAY"&&String(row.partyId||"")===props.supplierId&&Boolean(String(row.journalId||"").trim())&&["POSTED","CLEARED"].includes(String(row.status||"").toUpperCase())&&billRefs.has(String(row.againstDocumentId||"").trim())):[];setSettlementPayments(directSettlements);setBills((body.supplierBills||[]).filter((row:SupplierBill)=>String(row.poId||row.sourceDocumentId||"")===props.poId));setPo((body.purchaseOrders||[]).find((row:PurchaseOrder)=>String(row.poId||"")===props.poId)||null);const posted=linked.filter((row:Payment)=>String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId));const next:Record<string,Summary>={};await Promise.all(posted.map(async(row:Payment)=>{try{const r=await fetch(`/api/erp/advance-allocation?paymentId=${encodeURIComponent(row.paymentId)}`,{cache:"no-store"});const b=await r.json();if(r.ok&&b.ok)next[row.paymentId]=b.summary;}catch{}}));if(active)setSummaries(next);}catch(error){if(active)setMessage(error instanceof Error?error.message:"Supplier advance chain load failed");}finally{if(active)setLoading(false);}})();return()=>{active=false;};},[props.poId,props.supplierId]);

  const posted=useMemo(()=>payments.filter(row=>String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId)),[payments]);
  const advanceCreated=useMemo(()=>payments.reduce((sum,row)=>sum+Number(row.amount||0),0),[payments]);
  const advancePosted=useMemo(()=>posted.reduce((sum,row)=>sum+Number(row.amount||0),0),[posted]);
  const advanceAllocated=useMemo(()=>posted.reduce((sum,row)=>sum+Number(summaries[row.paymentId]?.allocatedAmount||0),0),[posted,summaries]);
  const advanceAvailable=useMemo(()=>posted.reduce((sum,row)=>sum+Number(summaries[row.paymentId]?.remainingAmount??row.amount??0),0),[posted,summaries]);
  const poTotal=Number(props.poTotal??po?.totalAmount??0),poRemainingAfterAdvance=Math.max(0,poTotal-advancePosted);
  const thisInvoiceAdvance=props.billId?posted.reduce((sum,row)=>sum+(summaries[row.paymentId]?.allocations||[]).filter(a=>String(a.againstDocumentId||a.milestone||"")===props.billId).reduce((s,a)=>s+Number(a.amount||0),0),0):0;
  const currentPayment=props.paymentId?payments.find(row=>row.paymentId===props.paymentId)||null:null;
  const currentSummary=currentPayment?summaries[currentPayment.paymentId]||null:null;
  const normalSupplierPayments=useMemo(()=>settlementPayments.reduce((sum,row)=>sum+Number(row.amount||0),0),[settlementPayments]);
  const billTotal=Number(props.billTotal||0),billOutstanding=Number(props.billOutstanding||0);
  const totalSettled=props.billId?Math.max(0,billTotal-billOutstanding):0;
  if(!loading&&payments.length===0&&settlementPayments.length===0&&props.context!=="invoice")return null;

  return <section className="panel no-print" style={{marginTop:20}}>
    <div className="form-title-row"><div><h3>{props.context==="invoice"?"Supplier Invoice Settlement Summary":"Supplier Advance Payment Status"}</h3><p className="small">{props.context==="invoice"?"Shows advance adjustments, posted supplier payments, total settled and the remaining invoice balance.":"Tracks the same supplier advance through Purchase Order → Supplier Invoice → partial/full allocation. Unused advance stays available for later invoices from this PO."}</p></div><span className="auto-badge">{loading?"Loading…":props.context==="invoice"?`Settled ${money(totalSettled)}`:`PO Advance ${money(advancePosted)}`}</span></div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
    {!loading&&<>
      <div className="document-meta" style={{marginTop:14}}>
        <div><span>Purchase Order</span><strong><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(props.poId)}`}>{po?.poNumber||props.poId}</Link></strong></div>
        <div><span>PO Total</span><strong>{money(poTotal)}</strong></div><div><span>Advance Created</span><strong>{money(advanceCreated)}</strong></div><div><span>Advance Finalized / Paid</span><strong>{money(advancePosted)}</strong></div><div><span>Advance Adjusted to Invoice(s)</span><strong>{money(advanceAllocated)}</strong></div><div><span>Unallocated Advance Remaining</span><strong>{money(advanceAvailable)}</strong></div><div><span>PO Value Remaining After Paid Advance</span><strong>{money(poRemainingAfterAdvance)}</strong></div>
        {props.billId&&<div><span>Invoice Total</span><strong>{money(billTotal)}</strong></div>}{props.billId&&<div><span>Advance Settled</span><strong>{money(thisInvoiceAdvance)}</strong></div>}{props.billId&&<div><span>Supplier Payments Settled</span><strong>{money(normalSupplierPayments)}</strong></div>}{props.billId&&<div><span>Total Settled / Paid</span><strong>{money(totalSettled)}</strong></div>}{props.billId&&<div><span>This Invoice Outstanding</span><strong>{money(billOutstanding)}</strong></div>}
        {currentPayment&&<div><span>This Advance Payment</span><strong>{money(currentPayment.amount)}</strong></div>}{currentSummary&&<div><span>This Payment Allocated</span><strong>{money(currentSummary.allocatedAmount)}</strong></div>}{currentSummary&&<div><span>This Payment Remaining</span><strong>{money(currentSummary.remainingAmount)}</strong></div>}
      </div>
      {props.context==="invoice"&&settlementPayments.length>0&&(
        <div className="table-wrap" style={{marginTop:18}}>
          <div className="form-title-row"><div><strong>Supplier Payment History</strong><p className="small">Every finalized payment against this Supplier Invoice is retained as a separate accounting document.</p></div><span className="auto-badge">{settlementPayments.length+posted.length} Payment{settlementPayments.length+posted.length===1?"":"s"}</span></div>
          <table className="data-table" style={{marginTop:12}}>
            <thead><tr><th>Payment Entry</th><th>Created</th><th>Amount</th><th>Status</th><th>Allocated</th><th>Remaining</th><th>Adjusted Against</th></tr></thead>
            <tbody>{[...settlementPayments].sort((a,b)=>createdValue(b)-createdValue(a)).map(row=><tr key={row.paymentId}>
              <td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}>{row.paymentNumber||row.paymentId}</Link></td>
              <td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td>
              <td>{money(row.amount)}</td>
              <td>{row.status||"POSTED"}</td>
              <td>{money(row.amount)}</td>
              <td>{money(0)}</td>
              <td>{props.billId?<Link prefetch={false} href={`/transactions/supplierBill/${encodeURIComponent(props.billId)}`}>{props.billNumber||props.billId}</Link>:"—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {props.context==="payment" ? (
        <div className="table-wrap" style={{marginTop:18}}>
          <table className="data-table">
            <thead><tr><th>Purchase Order</th><th>Status</th><th>PO Total</th><th>Advance Finalized</th><th>Advance Allocated</th><th>Advance Remaining</th><th>Adjusted Against</th></tr></thead>
            <tbody>
              <tr>
                <td><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(props.poId)}`}><strong>{po?.poNumber||props.poId}</strong></Link></td>
                <td>{po?.status||"—"}</td>
                <td>{money(poTotal)}</td>
                <td>{money(advancePosted)}</td>
                <td>{money(advanceAllocated)}</td>
                <td>{money(advanceAvailable)}</td>
                <td>{(()=>{
                  const allocations=posted.flatMap(row=>(summaries[row.paymentId]?.allocations||[]).map(a=>({
                    id:String(a.againstDocumentId||a.milestone||""),
                    number:String(a.againstDocumentNumber||"")
                  }))).filter(a=>a.id);
                  const unique=[...new Map(allocations.map(a=>[a.id,a])).values()];
                  return unique.length
                    ? unique.map((allocation,index)=>{const bill=bills.find(b=>String(b.billId||"")===allocation.id);return <span key={allocation.id}>{index?", ":""}<Link href={`/transactions/supplierBill/${encodeURIComponent(allocation.id)}`}>{allocation.number||bill?.billNumber||allocation.id}</Link></span>;})
                    : "Unallocated";
                })()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : payments.length>0 ? (
        <div className="table-wrap" style={{marginTop:18}}><table className="data-table"><thead><tr><th>Advance Payment</th><th>Created</th><th>Amount</th><th>Status</th><th>Allocated</th><th>Remaining</th><th>Adjusted Against</th></tr></thead><tbody>{[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map(row=>{const summary=summaries[row.paymentId];const allocationBills=(summary?.allocations||[]).map(a=>({id:String(a.againstDocumentId||a.milestone||""),number:String(a.againstDocumentNumber||"")})).filter(a=>a.id);const uniqueAllocations=[...new Map(allocationBills.map(a=>[a.id,a])).values()];return<tr key={row.paymentId}><td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}>{row.paymentNumber||row.paymentId}</Link></td><td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td><td>{money(row.amount)}</td><td>{row.status||"DRAFT"}</td><td>{summary?money(summary.allocatedAmount):"—"}</td><td>{summary?money(summary.remainingAmount):"—"}</td><td>{uniqueAllocations.length?uniqueAllocations.map((allocation,index)=>{const bill=bills.find(b=>String(b.billId||"")===allocation.id);return<span key={allocation.id}>{index?", ":""}<Link href={`/transactions/supplierBill/${encodeURIComponent(allocation.id)}`}>{allocation.number||bill?.billNumber||allocation.id}</Link></span>}):"Unallocated"}</td></tr>;})}</tbody></table></div>
      ) : null}
    </>}
  </section>;
}