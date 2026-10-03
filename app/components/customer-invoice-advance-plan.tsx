"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Props={
  invoiceId:string;
  outstandingAmount:number;
  status:string;
  onPlanChange?:(summary:{plannedTotal:number;projectedOutstanding:number})=>void;
};
type PlannedAdvance={paymentId:string;paymentNumber:string;amount:number;allocated:number;available:number;planned:number;status:string;journalId:string;createdAt:string};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;

export default function CustomerInvoiceAdvancePlan(props:Props){
  const draft=String(props.status||"").toUpperCase()==="DRAFT";
  const[rows,setRows]=useState<PlannedAdvance[]>([]);
  const[amounts,setAmounts]=useState<Record<string,string>>({});
  const[plannedTotal,setPlannedTotal]=useState(0);
  const[projectedOutstanding,setProjectedOutstanding]=useState(Number(props.outstandingAmount||0));
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");

  async function load(){
    if(!draft){setLoading(false);return;}
    setLoading(true);
    try{
      const response=await fetch(`/api/erp/sales-invoice-advance-plan?invoiceId=${encodeURIComponent(props.invoiceId)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Customer Advance plan load failed");
      const next=(body.availableAdvances||[]) as PlannedAdvance[];
      setRows(next);
      setAmounts(Object.fromEntries(next.map(row=>[row.paymentId,String(row.planned||Math.min(row.available,Number(props.outstandingAmount||0)))])));
      setPlannedTotal(Number(body.plannedTotal||0));
      setProjectedOutstanding(Number(body.projectedOutstanding??props.outstandingAmount??0));
      props.onPlanChange?.({plannedTotal:Number(body.plannedTotal||0),projectedOutstanding:Number(body.projectedOutstanding??props.outstandingAmount??0)});
    }catch(error){setMessage(error instanceof Error?error.message:"Customer Advance plan load failed");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[props.invoiceId,props.status,props.outstandingAmount]);

  async function save(){
    if(busy)return;
    const allocations=rows.map(row=>({paymentId:row.paymentId,amount:Number(amounts[row.paymentId]||0)})).filter(row=>row.amount>0);
    setBusy(true);setMessage("Saving Customer Advance plan…");
    try{
      const response=await fetch("/api/erp/sales-invoice-advance-plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({invoiceId:props.invoiceId,allocations})});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Customer Advance plan save failed");
      setPlannedTotal(Number(body.plannedTotal||0));
      setProjectedOutstanding(Number(body.projectedOutstanding||0));
      props.onPlanChange?.({plannedTotal:Number(body.plannedTotal||0),projectedOutstanding:Number(body.projectedOutstanding||0)});
      setMessage(`Planned Customer Advance ${money(body.plannedTotal)}. Projected outstanding after approval: ${money(body.projectedOutstanding)}. No GL entry is created until Approve & Post.`);
      window.dispatchEvent(new Event("easynet:transaction-document-updated"));
    }catch(error){setMessage(error instanceof Error?error.message:"Customer Advance plan save failed");}
    finally{setBusy(false);}
  }

  if(!draft)return null;
  const enteredTotal=rows.reduce((sum,row)=>sum+Number(amounts[row.paymentId]||0),0);
  return <section className="panel table-wrap no-print" style={{marginTop:20}}>
    <div className="form-title-row">
      <div><h3>Apply Customer Advance on Approval</h3><p className="small">Select finalized Sales Quotation-linked advance receipts while this Sales Invoice is DRAFT. Approve & Post will post the invoice and apply the selected advance atomically.</p></div>
      <span className="auto-badge">{loading?"Loading…":`${money(plannedTotal)} Planned`}</span>
    </div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
    <div className="document-meta" style={{marginTop:14}}>
      <div><span>Invoice Outstanding Before Approval</span><strong>{money(props.outstandingAmount)}</strong></div>
      <div><span>Customer Advance Planned</span><strong>{money(plannedTotal)}</strong></div>
      <div><span>Projected Outstanding After Approval</span><strong>{money(projectedOutstanding)}</strong></div>
    </div>
    <table className="data-table" style={{marginTop:16}}>
      <thead><tr><th>Advance Receipt</th><th>Created</th><th>Original Advance</th><th>Available</th><th>Apply on Approval</th></tr></thead>
      <tbody>
        {!loading&&rows.length===0&&<tr><td colSpan={5}>No finalized, unallocated Customer Advance linked to this Sales Quotation.</td></tr>}
        {rows.map(row=><tr key={row.paymentId}>
          <td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber||row.paymentId}</strong></Link></td>
          <td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td>
          <td>{money(row.amount)}</td><td>{money(row.available)}</td>
          <td><input type="number" min="0" max={row.available} step="0.01" value={amounts[row.paymentId]??"0"} onChange={e=>setAmounts(current=>({...current,[row.paymentId]:e.target.value}))} disabled={busy}/></td>
        </tr>)}
      </tbody>
    </table>
    {rows.length>0&&<div className="button-row" style={{marginTop:14}}>
      <button type="button" disabled={busy||enteredTotal<0} onClick={()=>void save()}>{busy?"Saving Plan…":"Save Advance Plan"}</button>
      <span className="small">Entered total: <strong>{money(enteredTotal)}</strong>. No accounting effect until invoice approval.</span>
    </div>}
  </section>;
}
