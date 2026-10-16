"use client";
import Link from "next/link";
import { useCallback,useEffect,useMemo,useState } from "react";
type Receipt={paymentId:string;paymentNumber:string;customer:string;status:string;amount:number;paymentDate:string;bankAccount:string;reference:string;eligible:boolean;reason:string};
type Outcome={paymentId:string;number:string;status:string;message:string};
export default function BulkReceiptsClient(){
 const [receipts,setReceipts]=useState<Receipt[]>([]),[selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirmation,setConfirmation]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Outcome[]}|null>(null);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{const res=await fetch("/api/erp/sales-bulk-receipts",{cache:"no-store"}),data=await res.json();
   if(!res.ok||!data.ok)throw new Error(data.error||"Unable to load receipts");
   setReceipts(data.payments||[]);setSelected(old=>old.filter(id=>(data.payments||[]).some((p:Receipt)=>p.paymentId===id&&p.eligible)));
  }catch(err){setError(err instanceof Error?err.message:"Unable to load receipts");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const visible=useMemo(()=>receipts.filter(r=>[r.paymentNumber,r.customer,r.status,r.reference].join(" ").toLowerCase().includes(filter.toLowerCase().trim())),[receipts,filter]);
 const eligible=visible.filter(r=>r.eligible),chosen=selected.filter(id=>receipts.some(r=>r.paymentId===id&&r.eligible));
 const total=receipts.filter(r=>chosen.includes(r.paymentId)).reduce((sum,r)=>sum+Number(r.amount||0),0);
 async function run(){
  if(busy||!chosen.length||confirmation!=="FINALIZE RECEIPTS")return;
  if(!window.confirm("Finalize "+chosen.length+" approved existing Customer Receipt(s), total PGK "+total.toFixed(2)+"? This posts actual payment entries to the bank and accounting ledger, and cannot be undone by editing the receipt."))return;
  setBusy(true);setError("");setBatch(null);
  try{const res=await fetch("/api/erp/sales-bulk-receipts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"finalizeApprovedCustomerReceipts",paymentIds:chosen,confirmation})});
   const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"Batch failed");
   setBatch({batchId:data.batchId,results:data.results||[]});setSelected([]);setConfirmation("");await refresh();
   if(data.auditWarning)setError(data.auditWarning);
  }catch(err){setError(err instanceof Error?err.message:"Batch failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk Customer Receipt Finalization</h2><p className="small">Stage 6: Existing approved customer receipt entries → Finalized bank and accounting records</p></div></div>
 <p className="small"><Link href="/doctype/salesPayment">Customer Receipt Register</Link> · <Link href="/sales/bulk-allocations">Advance Allocations</Link></p>
 <section className="panel"><div className="form-title-row"><div><h3>Approved Receipt Preflight</h3><p className="small">Only approved, unfinalized incoming customer payments can be selected. Confirm source bank evidence before continuing.</p></div><button type="button" className="secondary" disabled={busy||loading} onClick={()=>void refresh()}>Refresh</button></div>
 <div className="ef-erp-action-feedback" data-tone="warning">This makes actual financial postings. It does not create receipts from invoices or verify bank settlement automatically. Review every receipt amount, payment method, bank account and supporting evidence before confirming.</div>
 {error&&<div role="alert" className="ef-erp-action-feedback" data-tone="error">{error}</div>}
 <label>Search existing receipts<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Receipt, customer, status, reference"/></label>
 <p className="small">{receipts.length} receipts · {receipts.filter(r=>r.eligible).length} eligible · {chosen.length} selected · Max 20 per batch</p>
 <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select eligible receipts" checked={eligible.length>0&&eligible.every(r=>chosen.includes(r.paymentId))} disabled={!eligible.length||busy} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...eligible.map(r=>r.paymentId)])].slice(0,20):old.filter(id=>!eligible.some(r=>r.paymentId===id)))}/></th><th>Receipt</th><th>Customer</th><th>Status</th><th>Amount (PGK)</th><th>Payment date</th><th>Bank Account</th><th>Eligibility</th></tr></thead><tbody>
 {visible.map(r=><tr key={r.paymentId}><td><input type="checkbox" aria-label={"Select "+r.paymentNumber} checked={chosen.includes(r.paymentId)} disabled={!r.eligible||busy||(!chosen.includes(r.paymentId)&&chosen.length>=20)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.paymentId]:old.filter(id=>id!==r.paymentId))}/></td><td>{r.paymentNumber||r.paymentId}</td><td>{r.customer}</td><td>{r.status}</td><td>{r.amount.toFixed(2)}</td><td>{r.paymentDate}</td><td>{r.bankAccount}</td><td>{r.eligible?"Ready":r.reason}</td></tr>)}
 {!visible.length&&<tr><td colSpan={8}>{loading?"Loading…":"No matching receipts"}</td></tr>}
 </tbody></table></div>
 <h3>Batch Review</h3><p className="small">Selected: {chosen.length} · Total PGK {total.toFixed(2)}</p>
 <label>Type FINALIZE RECEIPTS to confirm financial posting<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy} placeholder="FINALIZE RECEIPTS"/></label>
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={busy||loading||!chosen.length||confirmation!=="FINALIZE RECEIPTS"} onClick={()=>void run()}>{busy?"Finalizing…":"Finalize Selected Receipts ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Result</h3><p className="small">Batch ID: {batch.batchId} · Finalized: {batch.results.filter(r=>r.status==="finalized").length} · Blocked / Failed: {batch.results.filter(r=>r.status!=="finalized").length}</p>
 <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Result</th><th>Details</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.paymentId}><td>{r.number||r.paymentId}</td><td>{r.status}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button type="button" className="secondary" onClick={()=>{const csv=[["Receipt","Status","Message"],...batch.results.map(r=>[r.number||r.paymentId,r.status,r.message])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="receipt-finalization-"+batch.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}
 </div>;
}
