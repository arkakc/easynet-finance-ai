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

  async function applyPostedAdvance(){
    if(busy)return;
    const picked=rows.filter(row=>Number(row.available)>0.001&&Boolean(row.journalId)).map(row=>({row,amount:Number(amounts[row.paymentId]||0)})).filter(entry=>entry.amount>0);
    const total=picked.reduce((sum,entry)=>sum+entry.amount,0);
    if(!picked.length){setMessage("Select an advance amount.");return;}
    if(picked.some(entry=>!Number.isFinite(entry.amount)||entry.amount>Number(entry.row.available)+0.001)||total>Number(props.outstandingAmount)+0.001){setMessage("Adjustment exceeds invoice outstanding or available advance.");return;}
    if(!window.confirm("Apply "+money(total)+" of Customer Advance to this invoice? Accounting allocation will be posted."))return;
    setBusy(true);setMessage("Adjusting advance…");
    try {
      for(const entry of picked){
        const response=await fetch("/api/erp/advance-allocation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentId:entry.row.paymentId,partyType:"Customer",againstDocumentType:"Sales Invoice",againstDocumentId:props.invoiceId,amount:entry.amount,allocationDate:new Date().toISOString().slice(0,10),idempotencyKey:crypto.randomUUID()})});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||"Advance allocation failed");
      }
      setMessage("Advance adjusted. Invoice balance is refreshing.");
      window.dispatchEvent(new Event("easynet:transaction-document-updated"));
      await load();
    } catch(error){setMessage((error instanceof Error?error.message:"Advance adjustment failed")+". Some allocations may have posted. Refresh before retry.");}
    finally{setBusy(false);}
  }

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

  if(!draft&&["POSTED","PARTLY_PAID","PARTIAL"].includes(String(props.status||"").toUpperCase())&&Number(props.outstandingAmount)>0.001){
    const eligible=rows.filter(row=>Number(row.available)>0.001&&Boolean(row.journalId));
    const available=eligible.reduce((sum,row)=>sum+Number(row.available),0);
    const suggestion=Math.min(Number(props.outstandingAmount),available);
    return <section className="panel no-print" style={{marginTop:16}}>
      <div className="form-title-row"><div><h3>Customer Advance Detected</h3><p className="small">Posted unallocated advances are detected automatically. Confirm the adjustment before creating the final receipt.</p></div><span className="auto-badge">{loading?"Checking…":money(available)+" Available"}</span></div>
      {message&&<div role="status" className="status-banner" style={{marginTop:12}}>{message}</div>}
      <div className="document-meta" style={{marginTop:12}}><div><span>Invoice Outstanding</span><strong>{money(props.outstandingAmount)}</strong></div><div><span>Suggested Advance</span><strong>{money(suggestion)}</strong></div><div><span>Estimated Net Receipt</span><strong>{money(Math.max(0,Number(props.outstandingAmount)-suggestion))}</strong></div></div>
      {!loading&&eligible.length>0&&<><div className="table-wrap" style={{marginTop:12}}><table className="data-table"><thead><tr><th>Advance</th><th>Available</th><th>Apply</th></tr></thead><tbody>{eligible.map(row=><tr key={row.paymentId}><td><Link href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}>{row.paymentNumber||row.paymentId}</Link></td><td>{money(row.available)}</td><td><input type="number" min="0" max={Math.min(Number(row.available),Number(props.outstandingAmount))} step="0.01" value={amounts[row.paymentId]??"0"} onChange={event=>setAmounts(current=>({...current,[row.paymentId]:event.target.value}))} disabled={Boolean(busy)}/></td></tr>)}</tbody></table></div><div className="button-row" style={{marginTop:12}}><button type="button" disabled={Boolean(busy)} onClick={()=>void applyPostedAdvance()}>{busy?"Adjusting…":"Adjust Advance & Refresh Invoice"}</button></div></>}
      {!loading&&!eligible.length&&!message&&<p className="small">No eligible unallocated Customer Advance found.</p>}
    </section>;
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
