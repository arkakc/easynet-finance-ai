"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props={
  billId:string;
  billNumber:string;
  poId:string;
  supplierId:string;
  outstandingAmount:number;
  status:string;
  onPlanChange?:(summary:{plannedTotal:number;projectedOutstanding:number})=>void;
};
type Payment={paymentId:string;paymentNumber?:string;amount?:number|string;status?:string;journalId?:string;partyType?:string;partyId?:string;paymentType?:string;reference?:string;sourceDocumentId?:string;createdAt?:string};
type Summary={allocatedAmount:number;remainingAmount:number;allocations:any[]};
type PlannedAdvance={paymentId:string;paymentNumber:string;amount:number;allocated:number;available:number;planned:number;status:string;journalId:string;createdAt:string};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
function localDate(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${v.year}-${v.month}-${v.day}`;}
function createdValue(row:Payment|PlannedAdvance){const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;}

export default function SupplierInvoiceAdvanceAdjustment(props:Props){
  const router=useRouter();
  const normalizedStatus=String(props.status||"").toUpperCase();
  const draftInvoice=normalizedStatus==="DRAFT";
  const postedInvoice=["POSTED","PARTLY_PAID","PARTIAL"].includes(normalizedStatus);

  const[payments,setPayments]=useState<Payment[]>([]),[summaries,setSummaries]=useState<Record<string,Summary>>({}),[amounts,setAmounts]=useState<Record<string,string>>({});
  const[plannedAdvances,setPlannedAdvances]=useState<PlannedAdvance[]>([]);
  const[plannedAmounts,setPlannedAmounts]=useState<Record<string,string>>({});
  const[plannedTotal,setPlannedTotal]=useState(0);
  const[projectedOutstanding,setProjectedOutstanding]=useState(Number(props.outstandingAmount||0));
  const[loading,setLoading]=useState(true),[busyId,setBusyId]=useState(""),[message,setMessage]=useState("");
  const marker=`PO:${props.poId}|`;

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

  async function loadPostedAdvances(){
    const response=await fetch("/api/erp/transactions",{cache:"no-store"});
    const body=await response.json();
    if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance load failed");
    const rows=(body.payments||[]).filter((row:Payment)=>String(row.partyType||"")==="Supplier"&&String(row.paymentType||"").toUpperCase()==="PAY"&&String(row.partyId||"")===props.supplierId&&String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId)&&(String(row.sourceDocumentId||"")===props.poId||String(row.reference||"").startsWith(marker)));
    const next:Record<string,Summary>={};
    await Promise.all(rows.map(async(row:Payment)=>{try{const r=await fetch(`/api/erp/advance-allocation?paymentId=${encodeURIComponent(row.paymentId)}`,{cache:"no-store"});const b=await r.json();if(r.ok&&b.ok)next[row.paymentId]=b.summary;}catch{}}));
    const available=rows.filter((row:Payment)=>Number(next[row.paymentId]?.remainingAmount||0)>0.001);
    setPayments(available);
    setSummaries(next);
    setAmounts(Object.fromEntries(available.map((row:Payment)=>[row.paymentId,String(Math.min(Number(next[row.paymentId]?.remainingAmount||0),Number(props.outstandingAmount||0)))])));
  }

  async function load(){
    if(!props.poId){setLoading(false);return;}
    setLoading(true);
    try{
      if(draftInvoice) await loadDraftPlan();
      else if(postedInvoice) await loadPostedAdvances();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Supplier advance load failed");
    }finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[props.billId,props.poId,props.supplierId,props.status,props.outstandingAmount]);

  const totalAvailable=useMemo(()=>payments.reduce((sum,row)=>sum+Number(summaries[row.paymentId]?.remainingAmount||0),0),[payments,summaries]);

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

  async function allocate(payment:Payment){
    if(busyId)return;const summary=summaries[payment.paymentId];const amount=Number(amounts[payment.paymentId]||0);const max=Math.min(Number(summary?.remainingAmount||0),Number(props.outstandingAmount||0));
    if(!(amount>0)||amount>max+0.001){setMessage(`Allocation must be greater than zero and cannot exceed ${money(max)}.`);return;}
    if(!window.confirm(`Adjust ${money(amount)} from ${payment.paymentNumber||payment.paymentId} against ${props.billNumber}?`))return;
    setBusyId(payment.paymentId);setMessage("Adjusting Supplier Advance against Supplier Invoice…");
    try{const response=await fetch("/api/erp/advance-allocation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentId:payment.paymentId,partyType:"Supplier",againstDocumentType:"Supplier Invoice",againstDocumentId:props.billId,amount,allocationDate:localDate(),idempotencyKey:crypto.randomUUID()})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance adjustment failed");setMessage(`Adjusted ${money(body.result.allocatedAmount)}. Advance remaining ${money(body.result.remainingAdvance)}; Supplier Invoice outstanding ${money(body.result.documentOutstanding)}.`);await loadPostedAdvances();router.refresh();window.dispatchEvent(new Event("easynet:transaction-document-updated"));}catch(error){setMessage(error instanceof Error?error.message:"Supplier advance adjustment failed");}finally{setBusyId("");}
  }

  if(!props.poId||(!draftInvoice&&!postedInvoice))return null;

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

  return <section className="panel table-wrap no-print" style={{marginTop:20}}>
    <div className="form-title-row"><div><h3>Supplier Advance Adjustment</h3><p className="small">PO-linked posted advances can be allocated partially or fully. Accounting: Dr Accounts Payable / Cr Supplier Advances. Any unused advance remains available for later invoices from the same PO.</p></div><span className="auto-badge">{loading?"Loading…":`${money(totalAvailable)} Available`}</span></div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
    <table className="data-table"><thead><tr><th>Advance Payment</th><th>Created</th><th>Original Advance</th><th>Advance Remaining</th><th>Invoice Outstanding</th><th>Allocate Now</th><th>Action</th></tr></thead><tbody>
      {!loading&&payments.length===0&&<tr><td colSpan={7}>No unallocated posted Supplier Advance linked to this Purchase Order.</td></tr>}
      {[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map(row=>{const summary=summaries[row.paymentId];const max=Math.min(Number(summary?.remainingAmount||0),Number(props.outstandingAmount||0));return<tr key={row.paymentId}><td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber||row.paymentId}</strong></Link></td><td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td><td>{money(row.amount)}</td><td>{money(summary?.remainingAmount||0)}</td><td>{money(props.outstandingAmount)}</td><td><input type="number" min="0.01" max={max} step="0.01" value={amounts[row.paymentId]??String(max)} onChange={e=>setAmounts(current=>({...current,[row.paymentId]:e.target.value}))} disabled={Boolean(busyId)||max<=0}/></td><td><button type="button" disabled={Boolean(busyId)||max<=0} onClick={()=>void allocate(row)}>{busyId===row.paymentId?"Adjusting…":"Adjust Advance"}</button></td></tr>;})}
    </tbody></table>
  </section>;
}
