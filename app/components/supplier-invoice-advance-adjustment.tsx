"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props={billId:string;billNumber:string;poId:string;supplierId:string;outstandingAmount:number;status:string};
type Payment={paymentId:string;paymentNumber?:string;amount?:number|string;status?:string;journalId?:string;partyType?:string;partyId?:string;paymentType?:string;reference?:string;sourceDocumentId?:string;createdAt?:string};
type Summary={allocatedAmount:number;remainingAmount:number;allocations:any[]};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
function localDate(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${v.year}-${v.month}-${v.day}`;}
function createdValue(row:Payment){const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;}

export default function SupplierInvoiceAdvanceAdjustment(props:Props){
  const router=useRouter();
  const[payments,setPayments]=useState<Payment[]>([]),[summaries,setSummaries]=useState<Record<string,Summary>>({}),[amounts,setAmounts]=useState<Record<string,string>>({});
  const[loading,setLoading]=useState(true),[busyId,setBusyId]=useState(""),[message,setMessage]=useState("");
  const postedInvoice=["POSTED","PARTLY_PAID"].includes(String(props.status||"").toUpperCase());
  const marker=`PO:${props.poId}|`;

  async function load(){
    if(!props.poId||!postedInvoice){setLoading(false);return;}
    setLoading(true);
    try{
      const response=await fetch("/api/erp/transactions",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance load failed");
      const rows=(body.payments||[]).filter((row:Payment)=>String(row.partyType||"")==="Supplier"&&String(row.paymentType||"").toUpperCase()==="PAY"&&String(row.partyId||"")===props.supplierId&&String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId)&&(String(row.sourceDocumentId||"")===props.poId||String(row.reference||"").startsWith(marker)));
      const next:Record<string,Summary>={};await Promise.all(rows.map(async(row:Payment)=>{try{const r=await fetch(`/api/erp/advance-allocation?paymentId=${encodeURIComponent(row.paymentId)}`,{cache:"no-store"});const b=await r.json();if(r.ok&&b.ok)next[row.paymentId]=b.summary;}catch{}}));
      const available=rows.filter((row:Payment)=>Number(next[row.paymentId]?.remainingAmount||0)>0.001);setPayments(available);setSummaries(next);setAmounts(Object.fromEntries(available.map((row:Payment)=>[row.paymentId,String(Math.min(Number(next[row.paymentId]?.remainingAmount||0),Number(props.outstandingAmount||0)))])));
    }catch(error){setMessage(error instanceof Error?error.message:"Supplier advance load failed");}finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[props.billId,props.poId,props.supplierId,props.status,props.outstandingAmount]);
  const totalAvailable=useMemo(()=>payments.reduce((sum,row)=>sum+Number(summaries[row.paymentId]?.remainingAmount||0),0),[payments,summaries]);

  async function allocate(payment:Payment){
    if(busyId)return;const summary=summaries[payment.paymentId];const amount=Number(amounts[payment.paymentId]||0);const max=Math.min(Number(summary?.remainingAmount||0),Number(props.outstandingAmount||0));
    if(!(amount>0)||amount>max+0.001){setMessage(`Allocation must be greater than zero and cannot exceed ${money(max)}.`);return;}
    if(!window.confirm(`Adjust ${money(amount)} from ${payment.paymentNumber||payment.paymentId} against ${props.billNumber}?`))return;
    setBusyId(payment.paymentId);setMessage("Adjusting Supplier Advance against Supplier Invoice…");
    try{const response=await fetch("/api/erp/advance-allocation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentId:payment.paymentId,partyType:"Supplier",againstDocumentType:"Supplier Invoice",againstDocumentId:props.billId,amount,allocationDate:localDate(),idempotencyKey:crypto.randomUUID()})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance adjustment failed");setMessage(`Adjusted ${money(body.result.allocatedAmount)}. Advance remaining ${money(body.result.remainingAdvance)}; Supplier Invoice outstanding ${money(body.result.documentOutstanding)}.`);await load();router.refresh();}catch(error){setMessage(error instanceof Error?error.message:"Supplier advance adjustment failed");}finally{setBusyId("");}
  }

  if(!props.poId||!postedInvoice)return null;
  return <section className="panel table-wrap no-print" style={{marginTop:20}}>
    <div className="form-title-row"><div><h3>Supplier Advance Adjustment</h3><p className="small">PO-linked posted advances can be allocated partially or fully. Accounting: Dr Accounts Payable / Cr Supplier Advances. Any unused advance remains available for later invoices from the same PO.</p></div><span className="auto-badge">{loading?"Loading…":`${money(totalAvailable)} Available`}</span></div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
    <table className="data-table"><thead><tr><th>Advance Payment</th><th>Created</th><th>Original Advance</th><th>Advance Remaining</th><th>Invoice Outstanding</th><th>Allocate Now</th><th>Action</th></tr></thead><tbody>
      {!loading&&payments.length===0&&<tr><td colSpan={7}>No unallocated posted Supplier Advance linked to this Purchase Order.</td></tr>}
      {[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map(row=>{const summary=summaries[row.paymentId];const max=Math.min(Number(summary?.remainingAmount||0),Number(props.outstandingAmount||0));return<tr key={row.paymentId}><td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber||row.paymentId}</strong></Link></td><td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td><td>{money(row.amount)}</td><td>{money(summary?.remainingAmount||0)}</td><td>{money(props.outstandingAmount)}</td><td><input type="number" min="0.01" max={max} step="0.01" value={amounts[row.paymentId]??String(max)} onChange={e=>setAmounts(c=>({...c,[row.paymentId]:e.target.value}))} disabled={Boolean(busyId)||max<=0}/></td><td><button type="button" disabled={Boolean(busyId)||max<=0} onClick={()=>void allocate(row)}>{busyId===row.paymentId?"Adjusting…":"Adjust Advance"}</button></td></tr>;})}
    </tbody></table>
  </section>;
}