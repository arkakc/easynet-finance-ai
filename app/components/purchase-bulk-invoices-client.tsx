"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
type Order={id:string;number:string;supplier:string;status:string;eligible:boolean;reason:string;lines:{itemId:string;ordered:number;received:number}[]};
type Result={sourceId:string;number:string;status:string;createdId?:string;documentNumber?:string;message:string};
export default function PurchaseBulkInvoicesClient(){
 const [orders,setOrders]=useState<Order[]>([]),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Result[]}|null>(null);
 const reload=useCallback(async()=>{setLoading(true);setError("");try{
 const response=await fetch("/api/erp/purchase-bulk-invoices",{cache:"no-store"}),data=await response.json();
 if(!response.ok||!data.ok)throw Error(data.error||"Match preview failed");
 setOrders(data.orders||[]);setSelected(old=>old.filter(id=>(data.orders||[]).some((o:Order)=>o.id===id&&o.eligible)));
 }catch(e){setError(e instanceof Error?e.message:"Unable to fetch matching data");}finally{setLoading(false);}},[]);
 useEffect(()=>{void reload();},[reload]);
 const visible=useMemo(()=>orders.filter(r=>[r.number,r.supplier,r.status].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[orders,search]);
 const eligible=visible.filter(r=>r.eligible),chosen=selected.filter(id=>orders.some(r=>r.id===id&&r.eligible));
 async function execute(){
 if(busy||!chosen.length||confirm!=="CREATE DRAFT BILLS")return;
 if(!window.confirm("Create "+chosen.length+" DRAFT Supplier Bill(s) for fully received Purchase Orders? Compare supplier invoice prices and tax evidence before approving any bill. No AP or GST will be posted."))return;
 setBusy(true);setError("");setBatch(null);
 try{const response=await fetch("/api/erp/purchase-bulk-invoices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createMatchedSupplierBills",purchaseOrderIds:chosen,confirmation:confirm})}),data=await response.json();
 if(!response.ok||!data.ok)throw Error(data.error||"Batch failed");
 setBatch({batchId:data.batchId,results:data.results||[]});setSelected([]);setConfirm("");await reload();if(data.auditWarning)setError(data.auditWarning);
 }catch(e){setError(e instanceof Error?e.message:"Batch conversion failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk Supplier Invoice Matching</h2><p className="small">Phase 10: Purchase Order + posted Goods Receipt + existing Supplier Bill checks → Draft Supplier Bill</p></div></div>
 <p className="small"><Link href="/purchases/bulk-grn-posting">GRN Posting</Link> · <Link href="/transactions?module=purchase&tab=supplierInvoice&mode=list">Supplier Bills Register</Link></p>
 <section className="panel"><div className="form-title-row"><div><h3>Three-Way Matching Preflight</h3><p className="small">Only fully received stock-only orders qualify for safe draft conversion. Price/tax/supplier invoice evidence requires subsequent manual review.</p></div><button type="button" className="secondary" disabled={busy||loading} onClick={()=>void reload()}>Refresh Matches</button></div>
 <div className="ef-erp-action-feedback" data-tone="warning">This stage does not post Accounts Payable, input GST or GRNI settlement. Partial receipts, service lines and quantity exceptions are blocked until supported by a dedicated partial-invoicing workflow.</div>
 {error&&<p role="alert">{error}</p>}
 <label>Search Purchase Orders<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="PO, supplier or status"/></label>
 <p className="small">{orders.length} Purchase Orders inspected · {orders.filter(o=>o.eligible).length} matched · {chosen.length} selected · Maximum 20 per batch</p>
 <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select eligible Purchase Orders" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(o=>chosen.includes(o.id))} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,...eligible.map(o=>o.id)])].slice(0,20):old.filter(id=>!eligible.some(o=>o.id===id)))}/></th><th>Purchase Order</th><th>Supplier</th><th>Status</th><th>Stock lines</th><th>Result</th></tr></thead><tbody>
 {visible.map(o=><tr key={o.id}><td><input type="checkbox" aria-label={"Select "+o.number} checked={chosen.includes(o.id)} disabled={busy||!o.eligible||(!chosen.includes(o.id)&&chosen.length>=20)} onChange={e=>setSelected(old=>e.target.checked?[...old,o.id]:old.filter(id=>id!==o.id))}/></td><td>{o.number}</td><td>{o.supplier}</td><td>{o.status}</td><td>{o.lines.map(l=>l.received+"/"+l.ordered).join(", ")||"—"}</td><td>{o.eligible?"Matched":o.reason}</td></tr>)}
 {!visible.length&&<tr><td colSpan={6}>{loading?"Loading matches…":"No matching Purchase Orders"}</td></tr>}</tbody></table></div>
 <label>Type CREATE DRAFT BILLS to confirm<input value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={busy} placeholder="CREATE DRAFT BILLS"/></label>
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={busy||loading||!chosen.length||confirm!=="CREATE DRAFT BILLS"} onClick={()=>void execute()}>{busy?"Processing…":"Create Matched Draft Bills ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Conversion Results</h3><p className="small">Batch: {batch.batchId} · Created: {batch.results.filter(r=>r.status==="created").length} · Blocked/Failed: {batch.results.filter(r=>r.status!=="created").length}</p>
 <div className="table-wrap"><table><thead><tr><th>PO</th><th>Result</th><th>Draft Bill</th><th>Message</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.sourceId}><td>{r.number}</td><td>{r.status}</td><td>{r.createdId?<Link href={"/transactions/supplierInvoice/"+encodeURIComponent(r.createdId)}>{r.documentNumber||r.createdId}</Link>:"—"}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button className="secondary" type="button" onClick={()=>{const csv=[["PO","Status","Draft Bill","Message"],...batch.results.map(r=>[r.number,r.status,r.documentNumber||"",r.message])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="supplier-matching-"+batch.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}</div>;
}
