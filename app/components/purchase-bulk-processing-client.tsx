"use client";
import { useCallback,useEffect,useMemo,useState } from "react";
import Link from "next/link";
type Quote={id:string;number:string;supplier:string;status:string;amount:number;eligible:boolean;reason:string};
type Outcome={sourceId:string;status:string;number?:string;createdId?:string;message:string};
export default function PurchaseBulkProcessingClient(){
 const [quotes,setQuotes]=useState<Quote[]>([]),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Outcome[]}|null>(null);
 const refresh=useCallback(async()=>{setLoading(true);setError("");try{
  const response=await fetch("/api/erp/purchase-bulk-processing",{cache:"no-store"});const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||"Unable to load supplier quotations");
  setQuotes(data.quotes||[]);setSelected(old=>old.filter(id=>(data.quotes||[]).some((q:Quote)=>q.id===id&&q.eligible)));
 }catch(e){setError(e instanceof Error?e.message:"Preflight failed");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const visible=useMemo(()=>quotes.filter(q=>[q.number,q.supplier,q.status].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[quotes,search]);
 const selectable=visible.filter(q=>q.eligible),chosen=selected.filter(id=>quotes.some(q=>q.id===id&&q.eligible));
 const total=quotes.filter(q=>chosen.includes(q.id)).reduce((sum,q)=>sum+q.amount,0);
 async function execute(){
  if(!chosen.length||busy)return;
  if(!window.confirm("Convert "+chosen.length+" approved Supplier Quotation(s) into DRAFT Purchase Orders? No stock, AP, GST or bank posting will occur."))return;
  setBusy(true);setError("");setBatch(null);
  try{const response=await fetch("/api/erp/purchase-bulk-processing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"convertSupplierQuotes",supplierQuoteIds:chosen,confirm:true})});const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"Conversion failed");
   setBatch({batchId:data.batchId,results:data.results||[]});setSelected([]);await refresh();
   if(data.auditWarning)setError(data.auditWarning);
  }catch(e){setError(e instanceof Error?e.message:"Conversion failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Purchase Bulk Processing</h2><p className="small">Phase 7: Approved Supplier Quotations → Draft Purchase Orders</p></div></div>
 <section className="panel"><div className="form-title-row"><div><h3>Eligibility Preview</h3><p className="small">Approve Supplier Quotations and permanently save temporary items before conversion.</p></div><button className="secondary" type="button" disabled={loading||busy} onClick={()=>void refresh()}>Refresh Eligibility</button></div>
 <div className="ef-erp-action-feedback" data-tone="warning">Bulk conversion creates draft Purchase Orders only. Existing approvals and item-master checks are enforced. Receiving, supplier invoicing and payment posting are separate processes.</div>
 {error&&<p role="alert">{error}</p>}
 <label>Search quotations<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Quotation, supplier or status"/></label>
 <p className="small">{quotes.length} Supplier Quotations · {quotes.filter(q=>q.eligible).length} eligible · {chosen.length} selected · Maximum 25 per batch</p>
 <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select eligible quotations" disabled={!selectable.length||busy} checked={selectable.length>0&&selectable.every(q=>chosen.includes(q.id))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...selectable.map(q=>q.id)])].slice(0,25):old.filter(id=>!selectable.some(q=>q.id===id)))}/></th><th>Supplier Quotation</th><th>Supplier</th><th>Status</th><th>Amount</th><th>Eligibility</th></tr></thead><tbody>
 {visible.map(q=><tr key={q.id}><td><input type="checkbox" aria-label={"Select "+q.number} checked={chosen.includes(q.id)} disabled={busy||!q.eligible||(!chosen.includes(q.id)&&chosen.length>=25)} onChange={e=>setSelected(old=>e.target.checked?[...old,q.id]:old.filter(id=>id!==q.id))}/></td><td>{q.number||q.id}</td><td>{q.supplier}</td><td>{q.status}</td><td>{q.amount.toFixed(2)}</td><td>{q.eligible?"Ready":q.reason}</td></tr>)}
 {!visible.length&&<tr><td colSpan={6}>{loading?"Loading…":"No matching quotations"}</td></tr>}
 </tbody></table></div>
 <p className="small">Selected total: {total.toFixed(2)} (source currency totals; do not treat mixed currencies as a consolidated PGK value)</p>
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={busy||loading||!chosen.length} onClick={()=>void execute()}>{busy?"Processing…":"Confirm & Convert Selected ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Results</h3><p className="small">Batch ID: {batch.batchId} · Created: {batch.results.filter(r=>r.status==="created").length} · Blocked / Failed: {batch.results.filter(r=>r.status!=="created").length}</p>
 <div className="table-wrap"><table><thead><tr><th>Source</th><th>Result</th><th>Purchase Order</th><th>Message</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.sourceId}><td>{r.sourceId}</td><td>{r.status}</td><td>{r.createdId?<Link href={"/transactions/purchaseOrder/"+encodeURIComponent(r.createdId)}>{r.number||r.createdId}</Link>:"—"}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button type="button" className="secondary" onClick={()=>{const csv=[["Source","Status","Purchase Order","Message"],...batch.results.map(r=>[r.sourceId,r.status,r.number||"",r.message])].map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="purchase-batch-"+batch.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}</div>;
}
