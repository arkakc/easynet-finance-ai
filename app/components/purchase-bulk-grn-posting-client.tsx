"use client";
import { useCallback,useEffect,useState } from "react";
import Link from "next/link";
type Line={itemId:string;itemCode:string;itemName:string;remainingQty:number;qty:number};
type Receipt={id:string;number:string;orderNumber:string;supplier:string;receiptDate:string;warehouseId:string;lines:Line[];selected:boolean};
type Outcome={receiptId:string;number:string;status:string;message:string;journalId?:string};
export default function BulkGrnPostingClient(){
 const [rows,setRows]=useState<Receipt[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirmation,setConfirmation]=useState("");
 const [batch,setBatch]=useState<{batchId:string;results:Outcome[]}|null>(null);
 const refresh=useCallback(async()=>{setLoading(true);setError("");try{const response=await fetch("/api/erp/purchase-bulk-grn-posting",{cache:"no-store"});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"Unable to load draft receipts");setRows((data.receipts||[]).map((r:Receipt)=>({...r,warehouseId:"",selected:false})));}catch(e){setError(e instanceof Error?e.message:"Load failed");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 function modify(id:string,fn:(r:Receipt)=>Receipt){setRows(old=>old.map(r=>r.id===id?fn(r):r));}
 const chosen=rows.filter(r=>r.selected);
 const valid=chosen.length>0&&chosen.length<=10&&chosen.every(r=>r.warehouseId.trim()&&r.receiptDate&&r.lines.some(l=>l.qty>0)&&r.lines.every(l=>Number.isFinite(l.qty)&&l.qty>=0&&l.qty<=l.remainingQty));
 async function execute(){
  if(!valid||busy||confirmation!=="POST GOODS RECEIPTS")return;
  if(!window.confirm("POST STOCK IN AND GRNI for "+chosen.length+" Goods Receipt Note(s)? This creates inventory and accounting records. Verify physical receiving evidence and warehouse before continuing."))return;
  setBusy(true);setError("");setBatch(null);
  try{const response=await fetch("/api/erp/purchase-bulk-grn-posting",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"postGoodsReceipts",confirmation,receipts:chosen.map(r=>({receiptId:r.id,warehouseId:r.warehouseId.trim(),receiptDate:r.receiptDate,lines:r.lines.filter(l=>l.qty>0).map(l=>({itemId:l.itemId,qty:l.qty}))}))})});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"Batch posting failed");
   setBatch({batchId:data.batchId,results:data.results||[]});setConfirmation("");await refresh();if(data.auditWarning)setError(data.auditWarning);
  }catch(e){setError(e instanceof Error?e.message:"Posting failed");}finally{setBusy(false);}
 }
 return <div><div className="page-head"><div><h2>Bulk GRN Approval & Stock In</h2><p className="small">Controller review and atomic Purchase Receipt / Inventory / GRNI posting</p></div></div>
 <p className="small"><Link href="/purchases/bulk-receipts">Create Draft GRNs</Link> · <Link href="/transactions?module=purchase&tab=purchaseReceipt&mode=list">Goods Receipt Register</Link></p>
 <section className="panel"><div className="form-title-row"><h3>Draft Receipts</h3><button type="button" className="secondary" disabled={busy||loading} onClick={()=>void refresh()}>Refresh</button></div>
 <div className="ef-erp-action-feedback" data-tone="warning">Financial posting. Verify actual delivered items and quantities before selecting. Enter the correct warehouse ID for each receipt. Zero quantities are excluded. This action does not create Supplier Bills.</div>
 {error&&<p role="alert">{error}</p>}
 <p className="small">{rows.length} draft GRNs · {chosen.length} selected · Max 10 per batch</p>
 {rows.map(r=><div className="panel" key={r.id}><label><input type="checkbox" checked={r.selected} disabled={busy||(!r.selected&&chosen.length>=10)} onChange={e=>modify(r.id,x=>({...x,selected:e.target.checked}))}/> <strong>{r.number}</strong> · {r.orderNumber} · {r.supplier}</label>
 <div className="form-grid"><label>Warehouse ID<input value={r.warehouseId} disabled={busy} placeholder="Warehouse ID" onChange={e=>modify(r.id,x=>({...x,warehouseId:e.target.value}))}/></label><label>Receipt / posting date<input type="date" value={r.receiptDate} disabled={busy} onChange={e=>modify(r.id,x=>({...x,receiptDate:e.target.value}))}/></label></div>
 <div className="table-wrap"><table><thead><tr><th>Item</th><th>Remaining PO qty</th><th>Received qty to post</th></tr></thead><tbody>{r.lines.map(l=><tr key={l.itemId}><td>{l.itemCode} {l.itemName}</td><td>{l.remainingQty}</td><td><input aria-label={"Quantity "+l.itemCode+" on "+r.number} type="number" min="0" step="any" max={l.remainingQty} value={l.qty} disabled={busy} onChange={e=>modify(r.id,x=>({...x,lines:x.lines.map(item=>item.itemId===l.itemId?{...item,qty:Number(e.target.value)}:item)}))}/></td></tr>)}</tbody></table></div></div>)}
 {!rows.length&&<p className="small">{loading?"Loading draft GRNs…":"No draft GRNs available"}</p>}
 <h3>Final Authorization</h3><p className="small">Selected receipts: {chosen.map(r=>r.number).join(", ")||"None"}</p>
 <label>Type POST GOODS RECEIPTS to confirm<input value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} placeholder="POST GOODS RECEIPTS"/></label>
 <div className="ef-erp-action-toolbar"><button type="button" className="ef-erp-action ef-erp-action-primary" disabled={busy||loading||!valid||confirmation!=="POST GOODS RECEIPTS"} onClick={()=>void execute()}>{busy?"Posting…":"Post Selected GRNs ("+chosen.length+")"}</button></div></section>
 {batch&&<section className="panel"><h3>Batch Posting Results</h3><p className="small">Batch ID: {batch.batchId} · Posted: {batch.results.filter(r=>r.status==="posted").length} · Blocked / Failed: {batch.results.filter(r=>r.status!=="posted").length}</p>
 <div className="table-wrap"><table><thead><tr><th>GRN</th><th>Result</th><th>Journal</th><th>Details</th></tr></thead><tbody>{batch.results.map(r=><tr key={r.receiptId}><td>{r.number||r.receiptId}</td><td>{r.status}</td><td>{r.journalId||"—"}</td><td>{r.message}</td></tr>)}</tbody></table></div>
 <button type="button" className="secondary" onClick={()=>{const csv=[["GRN","Result","Journal","Message"],...batch.results.map(r=>[r.number||r.receiptId,r.status,r.journalId||"",r.message])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="grn-posting-"+batch.batchId+".csv";a.click();URL.revokeObjectURL(url);}}>Download Results CSV</button></section>}
 </div>;
}
