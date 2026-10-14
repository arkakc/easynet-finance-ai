"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
type Quote={quoteId:string;quoteNumber:string;customerId:string;status:string;totalAmount:number;eligible:boolean;reason:string};
type Outcome={quoteId:string;status:string;documentNumber?:string;createdId?:string;message:string};
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Pacific/Port_Moresby"});
export default function SalesBulkProcessingClient(){
 const [quotes,setQuotes]=useState<Quote[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [filter,setFilter]=useState(""),[loading,setLoading]=useState(true),[processing,setProcessing]=useState(false);
 const [orderDate,setOrderDate]=useState(today),[error,setError]=useState(""),[result,setResult]=useState<{batchId:string;results:Outcome[]}|null>(null);
 const load=useCallback(async()=>{setLoading(true);setError("");try{const r=await fetch("/api/erp/sales-bulk-processing",{cache:"no-store"});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Unable to load quotations");setQuotes(d.quotes||[]);setSelected(old=>old.filter(id=>(d.quotes||[]).some((q:Quote)=>q.quoteId===id&&q.eligible)));}catch(e){setError(e instanceof Error?e.message:"Load failed");}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 const visible=useMemo(()=>quotes.filter(q=>[q.quoteNumber,q.customerId,q.status].join(" ").toLowerCase().includes(filter.trim().toLowerCase())),[quotes,filter]);
 const eligibleVisible=visible.filter(q=>q.eligible);
 const selection=selected.filter(id=>quotes.some(q=>q.quoteId===id&&q.eligible));
 const selectedRows=quotes.filter(q=>selection.includes(q.quoteId));
 async function execute(){
  if(!selection.length||processing)return;
  if(!window.confirm("Confirm conversion of "+selection.length+" approved quotation(s) to DRAFT Sales Orders? Each result is independent. No stock, invoice, GL or payment posting will occur."))return;
  setProcessing(true);setError("");setResult(null);
  try{
   const r=await fetch("/api/erp/sales-bulk-processing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"convertQuotesToOrders",quoteIds:selection,orderDate,confirm:true})});
   const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Batch failed");
   setResult({batchId:d.batchId,results:d.results||[]});setSelected([]);await load();
  }catch(e){setError(e instanceof Error?e.message:"Batch failed");}finally{setProcessing(false);}
 }
 return <div><div className="page-head"><div><h2>Sales Bulk Processing</h2><p className="small">Controlled document conversion. Stage 1: Approved Sales Quotation → Draft Sales Order.</p></div></div>
 <section className="panel"><div className="form-title-row"><div><h3>Preflight & Eligibility</h3><p className="small">Only eligible quotations are selectable. Server-side permissions and conversion checks run again for each source at execution.</p></div><button className="secondary" type="button" disabled={loading||processing} onClick={()=>void load()}>Refresh Eligibility</button></div>
 {error&&<div className="ef-erp-action-feedback" role="alert" data-tone="error">{error}</div>}
 <div className="ef-erp-action-feedback" data-tone="warning">A quotation must already have completed its approval workflow. Bulk conversion creates draft Sales Orders only. Delivery Notes, invoices and customer receipts require their own controlled steps.</div>
 <div className="form-grid"><label>Search quotations<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Quotation, customer or status"/></label><label>Sales Order date<input type="date" value={orderDate} onChange={e=>setOrderDate(e.target.value)} disabled={processing}/></label></div>
 <p className="small">{quotes.length} quotations loaded · {quotes.filter(q=>q.eligible).length} eligible · {selection.length} selected (maximum 25 per batch)</p>
 <div className="table-wrap"><table><thead><tr><th><input aria-label="Select all eligible visible quotations" type="checkbox" checked={eligibleVisible.length>0&&eligibleVisible.every(q=>selection.includes(q.quoteId))} disabled={processing||!eligibleVisible.length} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...eligibleVisible.map(q=>q.quoteId)])].slice(0,25):old.filter(id=>!eligibleVisible.some(q=>q.quoteId===id)))}/></th><th>Quotation</th><th>Customer</th><th>Status</th><th>Amount (PGK)</th><th>Eligibility</th></tr></thead><tbody>{visible.map(q=><tr key={q.quoteId}><td><input type="checkbox" aria-label={"Select "+q.quoteNumber} disabled={!q.eligible||processing||(!selection.includes(q.quoteId)&&selection.length>=25)} checked={selection.includes(q.quoteId)} onChange={e=>setSelected(old=>e.target.checked?[...old,q.quoteId]:old.filter(id=>id!==q.quoteId))}/></td><td>{q.quoteNumber||q.quoteId}</td><td>{q.customerId}</td><td>{q.status}</td><td>{Number(q.totalAmount||0).toFixed(2)}</td><td>{q.eligible?"Ready":q.reason}</td></tr>)}{!visible.length&&<tr><td colSpan={6}>{loading?"Loading…":"No matching quotations"}</td></tr>}</tbody></table></div>
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={processing||loading||!selection.length||!orderDate} onClick={()=>void execute()}>{processing?"Processing…":"Review & Convert Selected ("+selection.length+")"}</button></div></section>
 {selectedRows.length>0&&!result&&<section className="panel"><h3>Batch Preview</h3><p className="small">Selected: {selectedRows.map(q=>q.quoteNumber||q.quoteId).join(", ")}. Every record is revalidated independently before conversion.</p></section>}
 {result&&<section className="panel"><h3>Batch Result</h3><p className="small">Batch ID: {result.batchId} · Created: {result.results.filter(x=>x.status==="created").length} · Existing: {result.results.filter(x=>x.status==="existing").length} · Blocked / Failed: {result.results.filter(x=>["blocked","failed"].includes(x.status)).length}</p><div className="table-wrap"><table><thead><tr><th>Source</th><th>Result</th><th>Destination</th><th>Details</th></tr></thead><tbody>{result.results.map(row=><tr key={row.quoteId}><td>{row.quoteId}</td><td>{row.status}</td><td>{row.createdId?<Link href={"/transactions/salesOrder/"+encodeURIComponent(row.createdId)}>{row.documentNumber||row.createdId}</Link>:"—"}</td><td>{row.message}</td></tr>)}</tbody></table></div><button type="button" className="secondary" onClick={()=>{const csv=[["Source","Status","Destination","Message"],...result.results.map(r=>[r.quoteId,r.status,r.documentNumber||"",r.message])].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="sales-batch-"+result.batchId+".csv";a.click();URL.revokeObjectURL(a.href);}}>Download Results CSV</button></section>}
 </div>;
}
