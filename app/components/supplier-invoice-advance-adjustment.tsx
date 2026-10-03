"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props={
  billId:string;
  billNumber:string;
  poId:string;
  supplierId:string;
  outstandingAmount:number;
  status:string;
  onPlanChange?:(summary:{plannedTotal:number;projectedOutstanding:number})=>void;
};
type PlannedAdvance={paymentId:string;paymentNumber:string;amount:number;allocated:number;available:number;planned:number;status:string;journalId:string;createdAt:string};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
function createdValue(row:PlannedAdvance){const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;}

export default function SupplierInvoiceAdvanceAdjustment(props:Props){
  const normalizedStatus=String(props.status||"").toUpperCase();
  const draftInvoice=normalizedStatus==="DRAFT";

  const[plannedAdvances,setPlannedAdvances]=useState<PlannedAdvance[]>([]);
  const[plannedAmounts,setPlannedAmounts]=useState<Record<string,string>>({});
  const[plannedTotal,setPlannedTotal]=useState(0);
  const[projectedOutstanding,setProjectedOutstanding]=useState(Number(props.outstandingAmount||0));
  const[loading,setLoading]=useState(true),[busyId,setBusyId]=useState(""),[message,setMessage]=useState("");

  async function loadDraftPlan(){
    const response=await fetch(`/api/erp/supplier-invoice-advance-plan?billId=${encodeURIComponent(props.billId)}`,{cache:"no-store"});
    const body=await response.json();
    if(!response.ok||!body.ok)throw new Error(body.error||"Supplier Advance plan load failed");
    const rows=(body.availableAdvances||[]) as PlannedAdvance[];
    setPlannedAdvances(rows);
    setPlannedAmounts(Object.fromEntries(rows.map(row=>[row.paymentId,String(row.planned||Math.min(row.available,Number(props.outstandingAmount||0)))])));
    setPlannedTotal(Number(body.plannedTotal||0));
    setProjectedOutstanding(Number(body.projectedOutstanding??props.outstandingAmount??0));
    props.onPlanChange?.({plannedTotal:Number(body.plannedTotal||0),projectedOutstanding:Number(body.projectedOutstanding??props.outstandingAmount??0)});
  }

  async function load(){
    if(!props.poId){setLoading(false);return;}
    setLoading(true);
    try{
      if(draftInvoice) await loadDraftPlan();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Supplier advance load failed");
    }finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[props.billId,props.poId,props.supplierId,props.status,props.outstandingAmount]);

  async function savePlan(){
    if(busyId)return;
    const allocations=plannedAdvances
      .map(row=>({paymentId:row.paymentId,amount:Number(plannedAmounts[row.paymentId]||0)}))
      .filter(row=>row.amount>0);
    setBusyId("plan");
    setMessage("Saving Supplier Advance plan…");
    try{
      const response=await fetch("/api/erp/supplier-invoice-advance-plan",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({billId:props.billId,allocations}),
      });
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Supplier Advance plan save failed");
      setPlannedTotal(Number(body.plannedTotal||0));
      setProjectedOutstanding(Number(body.projectedOutstanding||0));
      props.onPlanChange?.({plannedTotal:Number(body.plannedTotal||0),projectedOutstanding:Number(body.projectedOutstanding||0)});
      setMessage(`Planned Supplier Advance ${money(body.plannedTotal)}. Projected outstanding after approval: ${money(body.projectedOutstanding)}. No GL entry is created until Approve & Post.`);
      window.dispatchEvent(new Event("easynet:transaction-document-updated"));
    }catch(error){
      setMessage(error instanceof Error?error.message:"Supplier Advance plan save failed");
    }finally{setBusyId("");}
  }

  if(!props.poId||!draftInvoice)return null;

  if(draftInvoice){
    const enteredTotal=plannedAdvances.reduce((sum,row)=>sum+Number(plannedAmounts[row.paymentId]||0),0);
    return <section className="panel table-wrap no-print" style={{marginTop:20}}>
      <div className="form-title-row">
        <div>
          <h3>Apply Supplier Advance on Approval</h3>
          <p className="small">Select finalized PO-linked advances now. This is only a planned allocation while the Supplier Invoice is DRAFT. Approve & Post will post the invoice and apply the selected advance atomically.</p>
        </div>
        <span className="auto-badge">{loading?"Loading…":`${money(plannedTotal)} Planned`}</span>
      </div>
      {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
      <div className="document-meta" style={{marginTop:14}}>
        <div><span>Invoice Outstanding Before Approval</span><strong>{money(props.outstandingAmount)}</strong></div>
        <div><span>Supplier Advance Planned</span><strong>{money(plannedTotal)}</strong></div>
        <div><span>Projected Outstanding After Approval</span><strong>{money(projectedOutstanding)}</strong></div>
      </div>
      <table className="data-table" style={{marginTop:16}}>
        <thead><tr><th>Advance Payment</th><th>Created</th><th>Original Advance</th><th>Available</th><th>Apply on Approval</th></tr></thead>
        <tbody>
          {!loading&&plannedAdvances.length===0&&<tr><td colSpan={5}>No finalized, unallocated Supplier Advance linked to this Purchase Order.</td></tr>}
          {[...plannedAdvances].sort((a,b)=>createdValue(a)-createdValue(b)).map(row=><tr key={row.paymentId}>
            <td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber||row.paymentId}</strong></Link></td>
            <td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td>
            <td>{money(row.amount)}</td>
            <td>{money(row.available)}</td>
            <td><input type="number" min="0" max={row.available} step="0.01" value={plannedAmounts[row.paymentId]??"0"} onChange={e=>setPlannedAmounts(current=>({...current,[row.paymentId]:e.target.value}))} disabled={Boolean(busyId)}/></td>
          </tr>)}
        </tbody>
      </table>
      {plannedAdvances.length>0&&<div className="button-row" style={{marginTop:14}}>
        <button type="button" disabled={Boolean(busyId)||enteredTotal<0} onClick={()=>void savePlan()}>{busyId==="plan"?"Saving Plan…":"Save Advance Plan"}</button>
        <span className="small">Entered total: <strong>{money(enteredTotal)}</strong>. No accounting effect until invoice approval.</span>
      </div>}
    </section>;
  }

}
