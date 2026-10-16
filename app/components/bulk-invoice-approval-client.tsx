"use client";
import Link from "next/link";
import { useCallback,useEffect,useMemo,useState } from "react";
type Invoice={invoiceId:string;invoiceNumber:string;customerId:string;status:string;totalAmount:number;gstAmount:number;eligible:boolean;reason:string};
type Result={sourceId:string;status:string;documentNumber:string;message:string};
export default function BulkInvoiceApprovalClient(){
 const [invoices,setInvoices]=useState<Invoice[]>([]),[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [note,setNote]=useState("Reviewed and authorized for financial posting"),[confirmation,setConfirmation]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Result[];auditWarning?:string}|null>(null);
 const refresh=useCallback(async()=>{setLoading(true);setError("");try{
  const r=await fetch("/api/erp/sales-bulk-invoice-approval",{cache:"no-store"}),d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d.error||"Unable to load invoice queue");
  setInvoices(d.invoices||[]);setSelected(old=>old.filter(id=>(d.invoices||[]).some((x:Invoice)=>x.invoiceId===id&&x.eligible)));
 }catch(e){setError(e instanceof Error?e.message:"Queue loading failed");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const visible=useMemo(()=>invoices.filter(i=>[i.invoiceNumber,i.customerId,i.status].join(" ").toLowerCase().includes(query.toLowerCase().trim())),[invoices,query]);
 const eligible=visible.filter(i=>i.eligible);
 const chosen=selected.filter(id=>invoices.some(i=>i.invoiceId===id&&i.eligible));
 const totals=invoices.filter(i=>chosen.includes(i.invoiceId)).reduce((a,i)=>({gross:a.gross+i.totalAmount,gst:a.gst+i.gstAmount}),{gross:0,gst:0});
 async function post(){
  if(busy||!chosen.length||confirmation!=="APPROVE AND POST"||note.trim().length<8)return;
  if(!window.confirm("FINANCIAL POSTING: Approve and post "+chosen.length+" Sales Invoice(s), total PGK "+totals.gross.toFixed(2)+"? This may create AR, revenue and GST journal entries and cannot be undone by cancelling a draft."))return;
  setBusy(true);setError("");setBatch(null);
  try{
   const r=await fetch("/api/erp/sales-bulk-invoice-approval",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approveAndPostInvoices",invoiceIds:chosen,confirmation,note})});
   const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Batch failed");
   setBatch({batchId:d.batchId,results:d.results||[],auditWarning:d.auditWarning||undefined});setSelected([]);setConfirmation("");
   await refresh();if(d.auditWarning)setError(d.auditWarning);
  }catch(e){setError(e instanceof Error?e.message:"Bulk posting failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk Invoice Approval & Posting</h2><p className="small">Controller-only processing. Approved invoices are posted through the existing accounting workflow.</p></div></div>
 <p className="small"><Link href="/sales/bulk-invoices">Bulk Invoice Drafts</Link> · <Link href="/sales/bulk-invoice-history">Invoice Conversion Audit</Link></p>
 <section className="panel"><div className="form-title-row"><div><h3>Invoice Posting Preflight</h3><p className="small">Select unposted draft Sales Invoices. Each invoice is revalidated at posting time.</p></div><button className="secondary" type="button" onClick={()=>void refresh()} disabled={busy||loading}>Refresh</button></div>
 <div className="ef-erp-action-feedback" data-tone="warning">This is a financial action, not document conversion. The existing approval workflow may post AR, revenue and GST. Customer receipts are never created automatically.</div>
 {error&&<div role="alert" className="ef-erp-action-feedback" data-tone="error">{error}</div>}
 <label>Search invoices<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Invoice, customer or status" /></label>
 <p className="small">{invoices.length} invoices · {invoices.filter(i=>i.eligible).length} ready · {chosen.length} selected · Maximum 20 per batch</p>
 <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select eligible invoices" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(i=>chosen.includes(i.invoiceId))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...eligible.map(i=>i.invoiceId)])].slice(0,20):old.filter(id=>!eligible.some(i=>i.invoiceId===id)))}/></th><th>Invoice</th><th>Customer</th><th>Status</th><th>Gross (PGK)</th><th>GST (PGK)</th><th>Eligibility</th></tr></thead><tbody>
 {visible.map(i=><tr key={i.invoiceId}><td><input aria-label={"Select "+i.invoiceNumber} type="checkbox" checked={chosen.includes(i.invoiceId)} disabled={busy||!i.eligible||(!chosen.includes(i.invoiceId)&&chosen.length>=20)} onChange={e=>setSelected(old=>e.target.checked?[...old,i.invoiceId]:old.filter(id=>id!==i.invoiceId))}/></td><td><Link href={"/transactions/salesInvoice/"+encodeURIComponent(i.invoiceId)}>{i.invoiceNumber||i.invoiceId}</Link></td><td>{i.customerId}</td><td>{i.status}</td><td>{i.totalAmount.toFixed(2)}</td><td>{i.gstAmount.toFixed(2)}</td><td>{i.eligible?"Ready":i.reason}</td></tr>)}
 {!visible.length&&<tr><td colSpan={7}>{loading?"Loading…":"No matching invoices"}</td></tr>}
 </tbody></table></div>
 <h3>Batch Review</h3><p className="small">Selected: {chosen.length} · Total gross: PGK {totals.gross.toFixed(2)} · Output GST: PGK {totals.gst.toFixed(2)}</p>
 <div className="form-grid"><label>Approval note (minimum 8 characters)<textarea rows={2} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><label>Type APPROVE AND POST to confirm<input value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} placeholder="APPROVE AND POST" /></label></div>
 <div className="ef-erp-action-toolbar"><button className="ef-erp-action ef-erp-action-primary" disabled={busy||loading||!chosen.length||confirmation!=="APPROVE AND POST"||note.trim().length<8} onClick={()=>void post()}>{busy?"Posting…":"Approve & Post Selected ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Posting Results</h3><p className="small">Batch ID: {batch.batchId} · Posted: {batch.results.filter(r=>r.status==="posted").length} · Blocked / Failed: {batch.results.filter(r=>r.status!=="posted").length}</p>{batch.auditWarning&&<p role="alert">{batch.auditWarning}</p>}
 <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Result</th><th>Details</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.sourceId}><td><Link href={"/transactions/salesInvoice/"+encodeURIComponent(r.sourceId)}>{r.documentNumber||r.sourceId}</Link></td><td>{r.status}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button className="secondary" type="button" onClick={()=>{const csv=[["Invoice","Status","Message"],...batch.results.map(r=>[r.documentNumber||r.sourceId,r.status,r.message])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="invoice-posting-"+batch.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}
 </div>;
}
