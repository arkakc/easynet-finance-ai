"use client";
import { useCallback,useEffect,useMemo,useState } from "react";
import Link from "next/link";
type Order={id:string;number:string;supplier:string;status:string;amount:number;eligible:boolean;reason:string};
type Result={sourceId:string;status:string;number?:string;createdId?:string;message:string};
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Pacific/Port_Moresby"});
export default function PurchaseBulkReceiptsClient(){
 const [orders,setOrders]=useState<Order[]>([]),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState("");
 const [date,setDate]=useState(today),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Result[]}|null>(null);
 const refresh=useCallback(async()=>{setLoading(true);setError("");try{const r=await fetch("/api/erp/purchase-bulk-receipts",{cache:"no-store"}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||"Unable to load Purchase Orders");setOrders(d.orders||[]);setSelected(old=>old.filter(id=>(d.orders||[]).some((o:Order)=>o.id===id&&o.eligible)));}catch(e){setError(e instanceof Error?e.message:"Preflight failed");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const visible=useMemo(()=>orders.filter(o=>[o.number,o.supplier,o.status].join(" ").toLowerCase().includes(search.toLowerCase().trim())),[orders,search]);
 const eligible=visible.filter(o=>o.eligible),chosen=selected.filter(id=>orders.some(o=>o.id===id&&o.eligible));
 async function execute(){
  if(!chosen.length||busy)return;
  if(!window.confirm("Create "+chosen.length+" DRAFT Goods Receipt Note(s)? Quantities, warehouse and stock posting must be reviewed separately. No inventory or GL entries will be created now."))return;
  setBusy(true);setError("");setBatch(null);
  try{const r=await fetch("/api/erp/purchase-bulk-receipts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createDraftGoodsReceipts",purchaseOrderIds:chosen,receiptDate:date,confirm:true})}),d=await r.json();
   if(!r.ok||!d.ok)throw Error(d.error||"Batch failed");setBatch({batchId:d.batchId,results:d.results||[]});setSelected([]);await refresh();if(d.auditWarning)setError(d.auditWarning);
  }catch(e){setError(e instanceof Error?e.message:"Batch failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk Goods Receipt Drafts</h2><p className="small">Purchase Orders → Draft Goods Receipt Notes (GRN)</p></div></div>
 <p className="small"><Link href="/purchases/bulk-processing">Bulk Supplier Quotation Conversion</Link> · <Link href="/transactions?module=purchase&tab=purchaseReceipt&mode=list">Goods Receipt Register</Link></p>
 <section className="panel"><div className="form-title-row"><div><h3>Goods Receipt Preflight</h3><p className="small">Approved Purchase Orders containing stock items. Each source is checked again during processing.</p></div><button type="button" className="secondary" disabled={busy||loading} onClick={()=>void refresh()}>Refresh Eligibility</button></div>
 <div className="ef-erp-action-feedback" data-tone="warning">Drafts only. Open each GRN to verify actual received quantities, warehouse and supplier documentation. Stock In and GRNI posting occur only during authorized receipt completion.</div>
 {error&&<p role="alert">{error}</p>}
 <div className="form-grid"><label>Search Purchase Orders<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="PO number, supplier or status"/></label><label>Receipt date<input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy}/></label></div>
 <p className="small">{orders.length} Purchase Orders · {orders.filter(o=>o.eligible).length} eligible · {chosen.length} selected · Maximum 25 per batch</p>
 <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select eligible orders" checked={eligible.length>0&&eligible.every(o=>chosen.includes(o.id))} disabled={!eligible.length||busy} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...eligible.map(o=>o.id)])].slice(0,25):old.filter(id=>!eligible.some(o=>o.id===id)))}/></th><th>Purchase Order</th><th>Supplier</th><th>Status</th><th>Order Amount</th><th>Eligibility</th></tr></thead><tbody>
 {visible.map(o=><tr key={o.id}><td><input type="checkbox" aria-label={"Select "+o.number} checked={chosen.includes(o.id)} disabled={!o.eligible||busy||(!chosen.includes(o.id)&&chosen.length>=25)} onChange={e=>setSelected(old=>e.target.checked?[...old,o.id]:old.filter(id=>id!==o.id))}/></td><td>{o.number}</td><td>{o.supplier}</td><td>{o.status}</td><td>{o.amount.toFixed(2)}</td><td>{o.eligible?"Ready":o.reason}</td></tr>)}
 {!visible.length&&<tr><td colSpan={6}>{loading?"Loading…":"No matching Purchase Orders"}</td></tr>}</tbody></table></div>
 {chosen.length>0&&<p className="small">Batch preview: {orders.filter(o=>chosen.includes(o.id)).map(o=>o.number).join(", ")}</p>}
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={busy||loading||!chosen.length||!date} onClick={()=>void execute()}>{busy?"Processing…":"Confirm & Create Draft GRNs ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Results</h3><p className="small">Batch ID: {batch.batchId} · Created: {batch.results.filter(r=>r.status==="created").length} · Existing: {batch.results.filter(r=>r.status==="existing").length} · Blocked / Failed: {batch.results.filter(r=>["blocked","failed"].includes(r.status)).length}</p>
 <div className="table-wrap"><table><thead><tr><th>Source PO</th><th>Result</th><th>Goods Receipt</th><th>Details</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.sourceId}><td>{r.sourceId}</td><td>{r.status}</td><td>{r.createdId?<Link href={"/transactions/purchaseReceipt/"+encodeURIComponent(r.createdId)}>{r.number||r.createdId}</Link>:"—"}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button type="button" className="secondary" onClick={()=>{const csv=[["Source","Result","GRN","Message"],...batch.results.map(r=>[r.sourceId,r.status,r.number||"",r.message])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="bulk-grn-"+batch.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}</div>;
}
