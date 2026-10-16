"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
type Order={salesOrderId:string;orderNumber:string;customer:string;status:string;totalAmount:number;eligible:boolean;reason:string};
type Outcome={sourceId:string;status:string;documentNumber?:string;createdId?:string;message:string};
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Pacific/Port_Moresby"});
export default function SalesBulkDeliveriesClient(){
 const [orders,setOrders]=useState<Order[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [search,setSearch]=useState(""),[date,setDate]=useState(today),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [result,setResult]=useState<{batchId:string;results:Outcome[]}|null>(null);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{const response=await fetch("/api/erp/sales-bulk-deliveries",{cache:"no-store"});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Unable to load Sales Orders");setOrders(data.orders||[]);setSelected(old=>old.filter(id=>(data.orders||[]).some((o:Order)=>o.salesOrderId===id&&o.eligible)));}
  catch(err){setError(err instanceof Error?err.message:"Unable to load orders");}finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const visible=useMemo(()=>orders.filter(o=>[o.orderNumber,o.customer,o.status].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[orders,search]);
 const selectable=visible.filter(o=>o.eligible);
 const ready=selected.filter(id=>orders.some(o=>o.salesOrderId===id&&o.eligible));
 async function create(){
  if(!ready.length||busy)return;
  if(!window.confirm("Create "+ready.length+" DRAFT Delivery Note(s)? This will NOT approve warehouse dispatch, move stock, or post COGS."))return;
  setBusy(true);setResult(null);setError("");
  try{
   const response=await fetch("/api/erp/sales-bulk-deliveries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createDraftDeliveryNotes",salesOrderIds:ready,deliveryDate:date,confirm:true})});
   const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Batch failed");
   setResult({batchId:data.batchId,results:data.results||[]});setSelected([]);await refresh();
  }catch(err){setError(err instanceof Error?err.message:"Batch failed");}finally{setBusy(false);}
 }
 return <div>
  <div className="page-head"><div><h2>Bulk Delivery Notes</h2><p className="small">Stage 2: Accepted Sales Orders → Draft Delivery Notes</p></div></div>
  <div className="ef-doctype-action-bar"><Link href="/sales/bulk-processing">Quotation → Order</Link><Link href="/sales/bulk-deliveries">Order → Delivery</Link></div>
  <section className="panel">
   <div className="form-title-row"><div><h3>Delivery Draft Preflight</h3><p className="small">Eligible Sales Orders only. Each source is independently rechecked before the draft is created.</p></div><button type="button" className="secondary" disabled={loading||busy} onClick={()=>void refresh()}>Refresh Eligibility</button></div>
   <div className="ef-erp-action-feedback" data-tone="warning">Draft creation only. Warehouse selection, authorized delivery approval, inventory movements and COGS posting remain in the existing Delivery Note workflow.</div>
   {error&&<div role="alert" className="ef-erp-action-feedback" data-tone="error">{error}</div>}
   <div className="form-grid"><label>Search Sales Orders<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Order number, customer or status"/></label><label>Delivery date<input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy}/></label></div>
   <p className="small">{orders.length} loaded · {orders.filter(o=>o.eligible).length} eligible · {ready.length} selected · Maximum 25 per batch</p>
   <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all eligible visible orders" disabled={!selectable.length||busy} checked={selectable.length>0&&selectable.every(o=>ready.includes(o.salesOrderId))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...selectable.map(o=>o.salesOrderId)])].slice(0,25):old.filter(id=>!selectable.some(o=>o.salesOrderId===id)))}/></th><th>Sales Order</th><th>Customer</th><th>Status</th><th>Amount (PGK)</th><th>Eligibility</th></tr></thead><tbody>
    {visible.map(o=><tr key={o.salesOrderId}><td><input type="checkbox" aria-label={"Select "+o.orderNumber} disabled={!o.eligible||busy||(!ready.includes(o.salesOrderId)&&ready.length>=25)} checked={ready.includes(o.salesOrderId)} onChange={e=>setSelected(old=>e.target.checked?[...old,o.salesOrderId]:old.filter(id=>id!==o.salesOrderId))}/></td><td>{o.orderNumber}</td><td>{o.customer}</td><td>{o.status}</td><td>{o.totalAmount.toFixed(2)}</td><td>{o.eligible?"Ready":o.reason}</td></tr>)}
    {!visible.length&&<tr><td colSpan={6}>{loading?"Loading…":"No matching Sales Orders"}</td></tr>}
   </tbody></table></div>
   {ready.length>0&&<p className="small">Batch preview: {orders.filter(o=>ready.includes(o.salesOrderId)).map(o=>o.orderNumber).join(", ")}</p>}
   <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={!ready.length||busy||loading||!date} onClick={()=>void create()}>{busy?"Processing…":"Confirm & Create Drafts ("+ready.length+")"}</button></div>
  </section>
  {result&&<section className="panel"><h3>Batch Result</h3><p className="small">Batch ID: {result.batchId} · Created: {result.results.filter(r=>r.status==="created").length} · Existing: {result.results.filter(r=>r.status==="existing").length} · Blocked / Failed: {result.results.filter(r=>["blocked","failed"].includes(r.status)).length}</p><div className="table-wrap"><table><thead><tr><th>Source Order</th><th>Result</th><th>Delivery Note</th><th>Details</th></tr></thead><tbody>{result.results.map(r=><tr key={r.sourceId}><td>{r.sourceId}</td><td>{r.status}</td><td>{r.createdId?<Link href={"/transactions/deliveryNote/"+encodeURIComponent(r.createdId)}>{r.documentNumber||r.createdId}</Link>:"—"}</td><td>{r.message}</td></tr>)}</tbody></table></div>
  <button type="button" className="secondary" onClick={()=>{const csv=[["Source","Status","Delivery Note","Message"],...result.results.map(r=>[r.sourceId,r.status,r.documentNumber||"",r.message])].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="bulk-deliveries-"+result.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}
 </div>;
}
