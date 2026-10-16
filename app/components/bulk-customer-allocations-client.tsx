"use client";
import { useState } from "react";
import Link from "next/link";
type Allocation={paymentId:string;invoiceId:string;amount:string;allocationDate:string};
type Result={paymentId:string;invoiceId:string;status:string;message:string};
const localDate=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Pacific/Port_Moresby"});
const empty=():Allocation=>({paymentId:"",invoiceId:"",amount:"",allocationDate:localDate()});
export default function BulkCustomerAllocationsClient(){
 const [rows,setRows]=useState<Allocation[]>([empty()]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [outcome,setOutcome]=useState<{batchId:string;results:Result[];auditWarning?:string}|null>(null);
 function update(index:number,field:keyof Allocation,value:string){setRows(prev=>prev.map((row,i)=>i===index?{...row,[field]:value}:row));}
 const valid=rows.length>0&&rows.every(r=>r.paymentId.trim()&&r.invoiceId.trim()&&r.allocationDate&&Number.isFinite(Number(r.amount))&&Number(r.amount)>0);
 async function execute(){
  if(!valid||busy)return;
  if(!window.confirm("Allocate "+rows.length+" existing CUSTOMER ADVANCE payment(s) to the specified posted invoice(s)? No new cash receipts will be created. Reconcile each result before retrying."))return;
  setBusy(true);setError("");setOutcome(null);
  try{
   const response=await fetch("/api/erp/sales-bulk-allocations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"allocateCustomerAdvances",confirm:true,allocations:rows.map(r=>({paymentId:r.paymentId.trim(),invoiceId:r.invoiceId.trim(),amount:Number(r.amount),allocationDate:r.allocationDate}))})});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Batch failed");
   setOutcome({batchId:data.batchId,results:data.results||[],auditWarning:data.auditWarning||undefined});
   if(data.auditWarning)setError(data.auditWarning);
  }catch(e){setError(e instanceof Error?e.message:"Batch failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk Customer Advance Allocations</h2><p className="small">Allocate existing finalized customer advances to posted Sales Invoices. No new payment entries or bank journals.</p></div></div>
 <p className="small"><Link href="/doctype/salesPayment">Customer Receipts</Link> · <Link href="/doctype/salesInvoice">Sales Invoices</Link></p>
 <section className="panel"><h3>Review Allocation Lines</h3>
 <div className="ef-erp-action-feedback" data-tone="warning">Enter backend document IDs, not display numbers. Each payment and invoice must belong to the same customer. The existing allocation service validates balances, source links and accounting rules. This is for finalized advances, not creating receipts from unpaid invoices.</div>
 {error&&<div role="alert" className="ef-erp-action-feedback" data-tone="error">{error}</div>}
 <div className="table-wrap"><table><thead><tr><th>Customer Payment ID</th><th>Sales Invoice ID</th><th>Amount (PGK)</th><th>Allocation date</th><th>Remove</th></tr></thead><tbody>
 {rows.map((r,index)=><tr key={index}><td><input aria-label={"Payment ID "+(index+1)} value={r.paymentId} disabled={busy} onChange={e=>update(index,"paymentId",e.target.value)} /></td><td><input aria-label={"Invoice ID "+(index+1)} value={r.invoiceId} disabled={busy} onChange={e=>update(index,"invoiceId",e.target.value)}/></td><td><input aria-label={"Amount "+(index+1)} type="number" step="0.01" min="0.01" value={r.amount} disabled={busy} onChange={e=>update(index,"amount",e.target.value)}/></td><td><input aria-label={"Date "+(index+1)} type="date" value={r.allocationDate} disabled={busy} onChange={e=>update(index,"allocationDate",e.target.value)}/></td><td><button type="button" className="secondary" disabled={busy||rows.length===1} onClick={()=>setRows(old=>old.filter((_,i)=>i!==index))}>Remove</button></td></tr>)}
 </tbody></table></div>
 <button type="button" className="secondary" disabled={busy||rows.length>=20} onClick={()=>setRows(old=>[...old,empty()])}>+ Add allocation line</button>
 <p className="small">{rows.length} allocation(s) · Maximum 20 per batch · Total PGK {rows.reduce((sum,r)=>sum+(Number(r.amount)||0),0).toFixed(2)}</p>
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={!valid||busy} onClick={()=>void execute()}>{busy?"Processing…":"Confirm & Allocate ("+rows.length+")"}</button></div>
 </section>
 {outcome&&<section className="panel"><h3>Allocation Results</h3><p className="small">Batch ID: {outcome.batchId} · Successful: {outcome.results.filter(r=>r.status==="allocated").length} · Blocked / Failed: {outcome.results.filter(r=>r.status!=="allocated").length}</p>
 <div className="table-wrap"><table><thead><tr><th>Payment ID</th><th>Invoice ID</th><th>Status</th><th>Details</th></tr></thead><tbody>{outcome.results.map((r,i)=><tr key={i}><td>{r.paymentId}</td><td>{r.invoiceId}</td><td>{r.status}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button type="button" className="secondary" onClick={()=>{const csv=[["Payment","Invoice","Status","Message"],...outcome.results.map(r=>[r.paymentId,r.invoiceId,r.status,r.message])].map(line=>line.map(cell=>'"'+String(cell).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="customer-allocations-"+outcome.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download CSV</button></section>}
 </div>;
}
