"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
type Row={id:string;number:string;supplier:string;status:string;billNumbers:string[];issues:string[];lines:{itemId:string;itemCode:string;ordered:number;received:number;billed:number;receivedNotBilled:number;exception:string|null}[]};
export default function PurchaseQuantityReconciliationPage(){
 const [rows,setRows]=useState<Row[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const load=useCallback(async()=>{setLoading(true);setError("");try{const r=await fetch("/api/reports/purchase-quantity-reconciliation",{cache:"no-store"}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||"Failed to load");setRows(d.orders||[]);}catch(e){setError(e instanceof Error?e.message:"Unable to load report");}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 const issues=rows.filter(r=>r.issues.length);
 return <div className="page-stack"><section className="page-header"><div><h1>Purchase Quantity Reconciliation</h1><p>Read-only ordered, received, billed and received-not-billed quantities. Finance review is required before GRNI clearance.</p></div><Link href="/purchases/bulk-invoices">Supplier Invoice Matching</Link></section>
 <section className="panel"><div className="form-title-row"><h2>Exception Register</h2><button className="secondary-btn" disabled={loading} onClick={()=>void load()}>Refresh</button></div>
 <p className="small">{rows.length} Purchase Orders inspected (latest 100) · {issues.length} with flagged exceptions. This report does not value GRNI or authorize AP/GST posting.</p>
 {error&&<p role="alert">{error}</p>}
 <div className="table-wrap"><table className="data-table"><thead><tr><th>Purchase Order</th><th>Supplier</th><th>Linked Bills</th><th>Item</th><th>Ordered</th><th>Received</th><th>Billed</th><th>Received not billed</th><th>Review</th></tr></thead><tbody>{rows.flatMap(r=>(r.lines.length?r.lines:[{itemId:"none",itemCode:"—",ordered:0,received:0,billed:0,receivedNotBilled:0,exception:null}]).map(l=><tr key={r.id+":"+l.itemId}><td>{r.number}</td><td>{r.supplier}</td><td>{r.billNumbers.join(", ")||"—"}</td><td>{l.itemCode}</td><td>{l.ordered}</td><td>{l.received}</td><td>{l.billed}</td><td>{l.receivedNotBilled}</td><td>{[...(l.exception?[l.exception]:[]),...r.issues].filter((v,i,a)=>a.indexOf(v)===i).join("; ")||"—"}</td></tr>))}{!rows.length&&<tr><td colSpan={9}>{loading?"Loading…":"No purchase data"}</td></tr>}</tbody></table></div></section></div>;
}
