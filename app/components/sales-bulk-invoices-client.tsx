"use client";
import Link from "next/link";
import { useCallback,useEffect,useMemo,useState } from "react";
type Order={salesOrderId:string;orderNumber:string;customer:string;status:string;amount:number;eligible:boolean;reason:string};
type Result={sourceId:string;status:string;createdId?:string;documentNumber?:string;message:string};
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Pacific/Port_Moresby"});
export default function BulkInvoiceClient(){
 const [orders,setOrders]=useState<Order[]>([]),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState("");
 const [date,setDate]=useState(today),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Result[]}|null>(null);
 const load=useCallback(async()=>{setLoading(true);setError("");try{
  const response=await fetch("/api/erp/sales-bulk-invoices",{cache:"no-store"});const data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||"Unable to load Sales Orders");
  setOrders(data.orders||[]);setSelected(prev=>prev.filter(id=>(data.orders||[]).some((o:Order)=>o.salesOrderId===id&&o.eligible)));
 }catch(e){setError(e instanceof Error?e.message:"Preflight failed");}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 const visible=useMemo(()=>orders.filter(o=>[o.orderNumber,o.customer,o.status].join(" ").toLowerCase().includes(search.toLowerCase().trim())),[orders,search]);
 const eligible=visible.filter(o=>o.eligible),chosen=selected.filter(id=>orders.some(o=>o.salesOrderId===id&&o.eligible));
 async function run(){if(!chosen.length||busy)return;
  if(!window.confirm("Generate up to "+chosen.length+" draft Sales Invoice(s) from delivered, not-yet-invoiced quantities? This does not approve, post revenue/GST, or create customer receipts."))return;
  setBusy(true);setError("");setBatch(null);
  try{const response=await fetch("/api/erp/sales-bulk-invoices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createDraftInvoices",salesOrderIds:chosen,invoiceDate:date,confirm:true})});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"Batch failed");
  setBatch({batchId:data.batchId,results:data.results||[]});setSelected([]);await load();
  }catch(e){setError(e instanceof Error?e.message:"Batch failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk Sales Invoices</h2><p className="small">Stage 3: Delivered Sales Orders → Draft Sales Invoices</p></div></div>
 <section className="panel"><div className="form-title-row"><div><h3>Invoice Preflight</h3><p className="small">Available delivered quantities only. Each order is rechecked before conversion.</p></div><button type="button" className="secondary" disabled={loading||busy} onClick={()=>void load()}>Refresh Eligibility</button></div>
 <p className="small"><Link href="/sales/bulk-processing">Quotation → Order</Link> · <Link href="/sales/bulk-deliveries">Order → Delivery</Link> · Invoice drafts</p>
 <div className="ef-erp-action-feedback" data-tone="warning">Only draft invoices are generated. Invoice approval, financial posting, GST release and customer payment allocation are separate workflows. Verify the batch results before retrying failed conversions.</div>
 {error&&<div role="alert" className="ef-erp-action-feedback" data-tone="error">{error}</div>}
 <div className="form-grid"><label>Search Sales Orders<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Order, customer or status"/></label><label>Invoice date<input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy}/></label></div>
 <p className="small">{orders.length} loaded · {orders.filter(o=>o.eligible).length} eligible · {chosen.length} selected · Max 25 per batch</p>
 <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select eligible Sales Orders" checked={eligible.length>0&&eligible.every(o=>chosen.includes(o.salesOrderId))} disabled={!eligible.length||busy} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...eligible.map(o=>o.salesOrderId)])].slice(0,25):old.filter(id=>!eligible.some(o=>o.salesOrderId===id)))}/></th><th>Sales Order</th><th>Customer</th><th>Status</th><th>Order total (PGK)</th><th>Eligibility</th></tr></thead><tbody>
 {visible.map(o=><tr key={o.salesOrderId}><td><input type="checkbox" aria-label={"Select "+o.orderNumber} disabled={!o.eligible||busy||(!chosen.includes(o.salesOrderId)&&chosen.length>=25)} checked={chosen.includes(o.salesOrderId)} onChange={e=>setSelected(old=>e.target.checked?[...old,o.salesOrderId]:old.filter(id=>id!==o.salesOrderId))}/></td><td>{o.orderNumber}</td><td>{o.customer}</td><td>{o.status}</td><td>{o.amount.toFixed(2)}</td><td>{o.eligible?"Ready":o.reason}</td></tr>)}
 {!visible.length&&<tr><td colSpan={6}>{loading?"Loading…":"No matching orders"}</td></tr>}
 </tbody></table></div>
 {chosen.length>0&&<p className="small">Selected for preview: {orders.filter(o=>chosen.includes(o.salesOrderId)).map(o=>o.orderNumber).join(", ")}</p>}
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={!chosen.length||busy||loading||!date} onClick={()=>void run()}>{busy?"Processing…":"Confirm & Generate Draft Invoices ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Results</h3><p className="small">Batch ID: {batch.batchId} · Created: {batch.results.filter(r=>r.status==="created").length} · Existing: {batch.results.filter(r=>r.status==="existing").length} · Blocked / Failed: {batch.results.filter(r=>["blocked","failed"].includes(r.status)).length}</p>
 <div className="table-wrap"><table><thead><tr><th>Source Order</th><th>Status</th><th>Sales Invoice</th><th>Details</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.sourceId}><td>{r.sourceId}</td><td>{r.status}</td><td>{r.createdId?<Link href={"/transactions/salesInvoice/"+encodeURIComponent(r.createdId)}>{r.documentNumber||r.createdId}</Link>:"—"}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button type="button" className="secondary" onClick={()=>{const csv=[["Source","Status","Invoice","Message"],...batch.results.map(r=>[r.sourceId,r.status,r.documentNumber||"",r.message])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="bulk-invoices-"+batch.batchId+".csv";anchor.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}
 </div>;
}
