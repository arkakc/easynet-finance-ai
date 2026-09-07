"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "menu" | "newItem" | "movement" | "details" | "register";
type Item = { itemId:string; itemCode:string; itemName:string; itemType:string; uom?:string; revenueAccount?:string; costAccount?:string; defaultRate:number|string; taxCode?:string; stockQty?:number|string; stockValue?:number|string; deferredRevenueMonths?:number|string };
type Movement = { movementId:string; movementDate:string; itemId:string; projectId:string; movementType:string; qtyIn:number|string; qtyOut:number|string; unitCost:number|string; value:number|string; valueAdjustment?:number|string; sourceDocumentId:string; journalId?:string };
type Project = { projectId:string; projectName:string };
type PurchaseOrder = { poId:string; poNumber:string; supplierId:string; projectId:string; status:string; totalAmount:number|string };
type POLine = { poLineId:string; poId:string; itemId?:string; description?:string; qty:number|string; uom?:string; rate:number|string };

type MovementKind = "PURCHASE_RECEIPT" | "PROJECT_ISSUE" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "RETURN_IN" | "RETURN_OUT" | "LANDED_COST" | "REVALUATION" | "NRV_WRITEDOWN";

const n=(value:unknown)=>Number(value||0);
const money=(value:unknown)=>`K${n(value).toFixed(2)}`;
const qtyText=(value:unknown)=>n(value).toLocaleString(undefined,{maximumFractionDigits:4});
const signedValue=(movement:Movement)=>{
  const explicit=n(movement.valueAdjustment);
  if(Math.abs(explicit)>0.0000001)return explicit;
  const value=Math.abs(n(movement.value));
  if(n(movement.qtyIn)>0)return value;
  if(n(movement.qtyOut)>0)return -value;
  return 0;
};

function localDate(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function approvedLifecycle(status:unknown){return ["APPROVED","PART_RECEIVED","RECEIVED","PART_BILLED","CONVERTED","BILL_CREATED","BILLED"].includes(String(status||"").toUpperCase());}
function receiptNumber(movementId:string){const match=movementId.match(/^(PR-\d{4}-[A-Z0-9]+)-\d{3}$/);return match?.[1]||movementId;}

export default function StockWorkspaceV4(){
  const[mode,setMode]=useState<Mode>("menu");
  const[items,setItems]=useState<Item[]>([]);
  const[movements,setMovements]=useState<Movement[]>([]);
  const[projects,setProjects]=useState<Project[]>([]);
  const[purchaseOrders,setPurchaseOrders]=useState<PurchaseOrder[]>([]);
  const[poLines,setPoLines]=useState<POLine[]>([]);
  const[nextItemCode,setNextItemCode]=useState("Loading…");
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(true);
  const[initialContextApplied,setInitialContextApplied]=useState(false);
  const[movementType,setMovementType]=useState<MovementKind>("PURCHASE_RECEIPT");
  const[sourcePoId,setSourcePoId]=useState("");
  const[receiptDate,setReceiptDate]=useState(localDate());
  const[receiptQty,setReceiptQty]=useState<Record<string,string>>({});
  const[selectedItemId,setSelectedItemId]=useState("");
  const[selectedMovementId,setSelectedMovementId]=useState("");
  const[valueItemId,setValueItemId]=useState("");

  async function load(){
    setLoading(true);
    try{
      const[stockResponse,masterResponse]=await Promise.all([
        fetch("/api/stock",{cache:"no-store"}).then(response=>response.json()),
        fetch("/api/masters",{cache:"no-store"}).then(response=>response.json()),
      ]);
      if(!stockResponse.ok)throw new Error(stockResponse.error||"Stock load failed");
      if(!masterResponse.ok)throw new Error(masterResponse.error||"Project load failed");
      setItems(stockResponse.items||[]);setMovements(stockResponse.movements||[]);setPurchaseOrders(stockResponse.purchaseOrders||[]);setPoLines(stockResponse.poLines||[]);setNextItemCode(stockResponse.nextItemCode||"AUTO");setProjects(masterResponse.projects||[]);
    }catch(error){setMessage(error instanceof Error?error.message:"Load failed");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  const itemMap=useMemo(()=>new Map(items.map(item=>[String(item.itemId),item])),[items]);
  const poMap=useMemo(()=>new Map(purchaseOrders.map(po=>[String(po.poId),po])),[purchaseOrders]);
  const stock=useMemo(()=>items.map(item=>{
    const rows=movements.filter(movement=>String(movement.itemId)===String(item.itemId));
    const qtyIn=rows.reduce((sum,movement)=>sum+n(movement.qtyIn),0);
    const qtyOut=rows.reduce((sum,movement)=>sum+n(movement.qtyOut),0);
    const qty=n(item.stockQty??qtyIn-qtyOut);
    const value=n(item.stockValue??rows.reduce((sum,movement)=>sum+signedValue(movement),0));
    return{...item,qtyIn,qtyOut,qty,value,movementCount:rows.length};
  }),[items,movements]);
  const stockItems=useMemo(()=>items.filter(item=>String(item.itemType||"").toUpperCase()==="STOCK"),[items]);

  function orderedFor(poId:string,itemId:string){return poLines.filter(line=>String(line.poId||"")===poId&&String(line.itemId||"")===itemId).reduce((sum,line)=>sum+n(line.qty),0);}
  function receivedFor(poId:string,itemId:string){return movements.filter(movement=>movement.movementType==="PURCHASE_RECEIPT"&&String(movement.sourceDocumentId||"")===poId&&String(movement.itemId||"")===itemId).reduce((sum,movement)=>sum+n(movement.qtyIn),0);}
  function remainingFor(poId:string,itemId:string){return Math.max(0,orderedFor(poId,itemId)-receivedFor(poId,itemId));}
  function poRateFor(poId:string,itemId:string){const lines=poLines.filter(line=>String(line.poId||"")===poId&&String(line.itemId||"")===itemId);const q=lines.reduce((sum,line)=>sum+n(line.qty),0);return q>0?lines.reduce((sum,line)=>sum+n(line.qty)*n(line.rate),0)/q:0;}
  function poHasRemainingStock(poId:string){return poLines.some(line=>{const item=itemMap.get(String(line.itemId||""));return item&&String(item.itemType||"").toUpperCase()==="STOCK"&&remainingFor(poId,String(item.itemId))>0.0001;});}

  const receiptReadyPurchaseOrders=useMemo(()=>purchaseOrders.filter(po=>!String(po.poNumber||"").toUpperCase().startsWith("SUPQ-")&&approvedLifecycle(po.status)&&poHasRemainingStock(String(po.poId))),[purchaseOrders,poLines,movements,itemMap]);
  const selectedPo=useMemo(()=>purchaseOrders.find(po=>String(po.poId)===sourcePoId)||null,[purchaseOrders,sourcePoId]);
  const receiptItems=useMemo(()=>sourcePoId?stockItems.filter(item=>orderedFor(sourcePoId,String(item.itemId))>0&&remainingFor(sourcePoId,String(item.itemId))>0.0001):[],[sourcePoId,stockItems,poLines,movements]);
  const selectedItem=useMemo(()=>stock.find(item=>String(item.itemId)===selectedItemId)||null,[stock,selectedItemId]);
  const selectedMovement=useMemo(()=>movements.find(movement=>String(movement.movementId)===selectedMovementId)||null,[movements,selectedMovementId]);
  const valueItem=useMemo(()=>stock.find(item=>String(item.itemId)===valueItemId)||null,[stock,valueItemId]);

  const movementRates=useMemo(()=>{
    const map=new Map<string,number>();const states=new Map<string,{qty:number;value:number;rate:number}>();
    for(const movement of movements){
      const key=String(movement.itemId);const current=states.get(key)||{qty:0,value:0,rate:0};
      const nextQty=current.qty+n(movement.qtyIn)-n(movement.qtyOut);const nextValue=current.value+signedValue(movement);
      const nextRate=nextQty>0?nextValue/nextQty:current.rate||n(movement.unitCost);
      states.set(key,{qty:nextQty,value:nextValue,rate:Math.max(0,nextRate)});map.set(String(movement.movementId),Math.max(0,nextRate));
    }
    return map;
  },[movements]);

  useEffect(()=>{
    if(loading||initialContextApplied||typeof window==="undefined")return;
    const params=new URLSearchParams(window.location.search);const requestedPo=String(params.get("sourcePo")||"");
    if(params.get("mode")==="movement"||requestedPo){setMode("movement");setMovementType("PURCHASE_RECEIPT");}
    if(requestedPo){const po=purchaseOrders.find(row=>String(row.poId)===requestedPo);if(!po)setMessage("Purchase Order not found.");else if(!approvedLifecycle(po.status))setMessage("Purchase Receipt can only be created from an approved Purchase Order.");else if(!poHasRemainingStock(requestedPo))setMessage("This Purchase Order has no remaining stock quantity to receive.");else setSourcePoId(requestedPo);}
    setInitialContextApplied(true);
  },[loading,initialContextApplied,purchaseOrders,poLines,movements]);

  async function postStock(action:string,record:unknown){
    const response=await fetch("/api/erp/actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:"stock",body:{action,record}})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Save failed");await load();return body;
  }

  async function saveItem(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;try{const body=await postStock("createItem",Object.fromEntries(new FormData(form).entries()));setMessage(`Item saved: ${body.row.itemCode||body.row.itemId}`);form.reset();}catch(error){setMessage(error instanceof Error?error.message:"Item save failed");}}
  async function savePurchaseReceipt(){
    try{
      if(!selectedPo)throw new Error("Select an approved Purchase Order");
      const lines=receiptItems.map(item=>({itemId:String(item.itemId),qty:n(receiptQty[String(item.itemId)])})).filter(line=>line.qty>0);if(!lines.length)throw new Error("Enter a Receive Qty for at least one PO item");
      for(const line of lines){const remaining=remainingFor(sourcePoId,line.itemId);if(line.qty>remaining+0.0001)throw new Error(`Receive Qty exceeds remaining quantity for ${itemMap.get(line.itemId)?.itemCode||line.itemId}`);}
      const body=await postStock("createPurchaseReceipt",{movementDate:receiptDate,sourceDocumentId:sourcePoId,projectId:selectedPo.projectId||"",lines});setMessage(`Purchase Receipt saved: ${body.receiptNumber} · Inventory ${money(body.inventoryValue)} · GL ${body.journalId||"posted"}`);setReceiptQty({});
    }catch(error){setMessage(error instanceof Error?error.message:"Purchase Receipt failed");}
  }
  async function saveOtherMovement(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;try{const body=await postStock("createMovement",Object.fromEntries(new FormData(form).entries()));setMessage(`Movement saved: ${body.row.movementId} · Moving Average ${money(body.valuation?.movingAverageRate)} · GL ${body.journalId||"posted"}`);form.reset();}catch(error){setMessage(error instanceof Error?error.message:"Movement save failed");}}
  async function saveValueAdjustment(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;try{const values=Object.fromEntries(new FormData(form).entries());const body=await postStock("createValueAdjustment",{...values,adjustmentType:movementType});setMessage(`${movementType.replaceAll("_"," ")} saved · Value change ${money(body.valuation?.valueAdjustment)} · New moving average ${money(body.valuation?.movingAverageRate)} · GL ${body.journalId||"posted"}`);form.reset();setValueItemId("");}catch(error){setMessage(error instanceof Error?error.message:"Inventory valuation adjustment failed");}}

  function fillAllRemaining(){const next:Record<string,string>={};for(const item of receiptItems)next[String(item.itemId)]=String(remainingFor(sourcePoId,String(item.itemId)));setReceiptQty(next);}
  function openItem(itemId:string){setSelectedItemId(itemId);setSelectedMovementId("");setMode("details");}
  function openMovement(movementId:string){setSelectedMovementId(movementId);setMode("register");}
  const sourceLink=(movement:Movement)=>{const po=poMap.get(String(movement.sourceDocumentId||""));return po?<Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(po.poId)}`}><strong>{po.poNumber||po.poId}</strong></Link>:<span>{movement.sourceDocumentId||"—"}</span>;};
  const valueAdjustment=["LANDED_COST","REVALUATION","NRV_WRITEDOWN"].includes(movementType);

  return <>
    <div className="page-heading"><div><h2>Items & Stock</h2><p className="small">Perpetual inventory, approved-PO receipts, moving-average valuation, COGS support and inventory accounting controls.</p></div></div>
    {message&&<section className="panel status-banner"><strong>Status:</strong> {message}</section>}

    {mode==="menu"&&<section className="panel"><h3>Items & Stock</h3><p className="small">Choose one workspace. Stock quantity, valuation and GL traceability stay linked to Item Master.</p><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:16,marginTop:20}}>
      <button type="button" style={{minHeight:110,textAlign:"left"}} onClick={()=>setMode("newItem")}><strong style={{display:"block",fontSize:17}}>New Item</strong><span style={{display:"block",marginTop:8,fontWeight:400}}>Create Stock, Service or Non-Stock Item Master.</span></button>
      <button type="button" className="secondary" style={{minHeight:110,textAlign:"left"}} onClick={()=>setMode("movement")}><strong style={{display:"block",fontSize:17}}>New Stock Movement / Goods Receipt</strong><span style={{display:"block",marginTop:8,fontWeight:400}}>PO receipt, issue, return, landed cost, revaluation and NRV.</span></button>
      <button type="button" className="secondary" style={{minHeight:110,textAlign:"left"}} onClick={()=>setMode("details")}><strong style={{display:"block",fontSize:17}}>Item & Stock Details</strong><span style={{display:"block",marginTop:8,fontWeight:400}}>Balance, UOM, moving-average cost and linked history.</span></button>
      <button type="button" className="secondary" style={{minHeight:110,textAlign:"left"}} onClick={()=>setMode("register")}><strong style={{display:"block",fontSize:17}}>Movement Register</strong><span style={{display:"block",marginTop:8,fontWeight:400}}>Full stock and valuation ledger with GL/source links.</span></button>
    </div></section>}

    {mode!=="menu"&&<section className="panel"><div className="button-row" style={{justifyContent:"space-between"}}><button type="button" className="secondary" onClick={()=>{setMode("menu");setSelectedItemId("");setSelectedMovementId("");}}>← Back to Items & Stock</button><span className="auto-badge">{loading?"Loading…":`${items.length} Items · ${movements.length} Movements`}</span></div></section>}

    {mode==="newItem"&&<form className="panel form-grid" onSubmit={saveItem}><h3 className="form-title">New Item</h3><label>Item Code<input value={nextItemCode||"AUTO"} readOnly/></label><label>Item Name<input name="itemName" required/></label><label>Type<select name="itemType" defaultValue="STOCK"><option>STOCK</option><option>SERVICE</option><option>NON_STOCK</option></select></label><label>Default UOM<input name="uom" defaultValue="Each" required/></label><label>Revenue Account<input name="revenueAccount" defaultValue="ACC-4200"/></label><label>Cost / COGS Account<input name="costAccount" defaultValue="ACC-5100"/></label><label>Moving Average Rate<input value="0.00" readOnly/><span className="small">Calculated by stock valuation; not manually editable.</span></label><label>Deferred Revenue Months<input name="deferredRevenueMonths" type="number" min="0" max="120" defaultValue="0"/><span className="small">For Service/Non-Stock. 0 = use account policy / immediate revenue.</span></label><label>Tax Code<input name="taxCode"/></label><div className="form-wide"><button type="submit">Save Item</button></div></form>}

    {mode==="movement"&&<>
      <section className="panel"><div className="form-title-row"><div><h3>New Stock Movement / Goods Receipt</h3><p className="small">Physical movements and value-only adjustments post to both Stock Ledger and General Ledger.</p></div></div><div className="form-grid"><label>Movement<select value={movementType} onChange={event=>{setMovementType(event.target.value as MovementKind);setSourcePoId("");setReceiptQty({});setValueItemId("");}}><option value="PURCHASE_RECEIPT">PURCHASE RECEIPT / GOODS RECEIPT</option><option value="PROJECT_ISSUE">PROJECT ISSUE</option><option value="ADJUSTMENT_IN">ADJUSTMENT IN</option><option value="ADJUSTMENT_OUT">ADJUSTMENT OUT</option><option value="RETURN_IN">RETURN IN</option><option value="RETURN_OUT">RETURN OUT</option><option value="LANDED_COST">LANDED COST CAPITALIZATION</option><option value="REVALUATION">INVENTORY REVALUATION</option><option value="NRV_WRITEDOWN">NRV WRITE-DOWN</option></select></label></div></section>

      {movementType==="PURCHASE_RECEIPT"&&<section className="panel"><div className="form-grid"><label>Receipt Date<input type="date" value={receiptDate} onChange={event=>setReceiptDate(event.target.value)} required/></label><label>Approved Purchase Order<select value={sourcePoId} onChange={event=>{setSourcePoId(event.target.value);setReceiptQty({});}} required><option value="">Select approved PO with stock remaining</option>{receiptReadyPurchaseOrders.map(po=><option key={po.poId} value={po.poId}>{po.poNumber||po.poId} — {po.supplierId||"Supplier"}</option>)}</select></label><label>Project<input value={selectedPo?.projectId||""} readOnly placeholder="From Purchase Order"/></label>{selectedPo&&<label>Accounting<input value="Dr Inventory / Cr GRNI" readOnly/></label>}</div>
        {selectedPo&&<div className="table-wrap" style={{marginTop:18}}><div className="form-title-row"><div><h4 style={{margin:0}}>Purchase Order Items</h4><p className="small">Partial receipts allowed. PO Rate and Moving Average are read-only.</p></div><div className="button-row"><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(selectedPo.poId)}`}>View PO</Link><button type="button" className="secondary" onClick={fillAllRemaining}>Receive All Remaining</button></div></div><table className="data-table" style={{minWidth:1180}}><thead><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>PO Rate</th><th>Current Avg</th><th>Receive Qty</th><th>Projected Avg</th></tr></thead><tbody>{receiptItems.length===0&&<tr><td colSpan={10}>No stock quantity remains to receive.</td></tr>}{receiptItems.map(item=>{const id=String(item.itemId);const ordered=orderedFor(sourcePoId,id);const received=receivedFor(sourcePoId,id);const remaining=Math.max(0,ordered-received);const poRate=poRateFor(sourcePoId,id);const currentQty=n(item.stockQty);const currentRate=n(item.defaultRate);const receive=n(receiptQty[id]);const projected=receive>0?((currentQty*currentRate)+(receive*poRate))/Math.max(0.0000001,currentQty+receive):currentRate;return <tr key={id}><td><Link prefetch={false} href={`/stock/item/${encodeURIComponent(id)}`}><strong>{item.itemCode||id}</strong></Link></td><td>{item.itemName}</td><td>{item.uom||"Each"}</td><td>{qtyText(ordered)}</td><td>{qtyText(received)}</td><td><strong>{qtyText(remaining)}</strong></td><td>{money(poRate)}</td><td>{money(currentRate)}</td><td><input type="number" min="0" max={remaining} step="0.0001" value={receiptQty[id]||""} onChange={event=>setReceiptQty(current=>({...current,[id]:event.target.value}))}/></td><td><strong>{money(projected)}</strong></td></tr>;})}</tbody></table><div className="button-row" style={{marginTop:18,justifyContent:"flex-end"}}><button type="button" onClick={()=>void savePurchaseReceipt()}>Save Purchase Receipt</button></div></div>}
      </section>}

      {!valueAdjustment&&movementType!=="PURCHASE_RECEIPT"&&<form className="panel form-grid" onSubmit={saveOtherMovement}><h3 className="form-title">{movementType.replaceAll("_"," ")}</h3><input type="hidden" name="movementType" value={movementType}/><label>Date<input name="movementDate" type="date" defaultValue={localDate()} required/></label><label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map(project=><option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></label><label>Item<select name="itemId" required defaultValue=""><option value="">Select stock item</option>{stockItems.map(item=><option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}</select></label><label>Quantity<input name="qty" type="number" min="0.0001" step="0.0001" required/></label>{movementType==="ADJUSTMENT_IN"?<label>Unit Cost<input name="unitCost" type="number" min="0.0001" step="0.0001" required/></label>:<label>Unit Cost<input value="Moving average on save" readOnly/> </label>}<label>Source Document ID<input name="sourceDocumentId" placeholder="Optional reference"/></label><div className="form-wide"><button type="submit">Save Movement</button></div></form>}

      {valueAdjustment&&<form className="panel form-grid" onSubmit={saveValueAdjustment}><h3 className="form-title">{movementType.replaceAll("_"," ")}</h3><label>Date<input name="movementDate" type="date" defaultValue={localDate()} required/></label><label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map(project=><option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></label><label>Stock Item<select name="itemId" required value={valueItemId} onChange={event=>setValueItemId(event.target.value)}><option value="">Select stock item</option>{stockItems.map(item=><option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}</select></label><label>Current Qty<input value={valueItem?qtyText(valueItem.stockQty):"—"} readOnly/></label><label>Current Moving Average<input value={valueItem?money(valueItem.defaultRate):"—"} readOnly/></label><label>Current Book Value<input value={valueItem?money(valueItem.stockValue):"—"} readOnly/></label>{movementType==="LANDED_COST"?<label>Landed Cost Amount<input name="amount" type="number" min="0.01" step="0.01" required/><span className="small">Capitalized into inventory. Cr Landed Cost Clearing.</span></label>:<label>Target Unit Cost / NRV<input name="targetUnitCost" type="number" min="0" step="0.0001" required/><span className="small">NRV may only reduce value. Revaluation can increase/decrease with GL offset.</span></label>}<label>Source / Reference<input name="sourceDocumentId" placeholder="Freight invoice, valuation memo, review reference"/></label><div className="form-wide"><button type="submit">Save {movementType.replaceAll("_"," ")}</button></div></form>}
    </>}

    {mode==="details"&&<>{!selectedItem&&<section className="panel"><div className="form-title-row"><div><h3>Item & Stock Details</h3><p className="small">Click an item to review accounting and valuation history.</p></div><span className="auto-badge">{stock.length} Items</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14,marginTop:18}}>{stock.map(item=><button key={item.itemId} type="button" className="secondary" onClick={()=>openItem(String(item.itemId))} style={{minHeight:120,textAlign:"left",padding:16}}><strong style={{display:"block",fontSize:16}}>{item.itemCode} — {item.itemName}</strong><span style={{display:"block",marginTop:8}}>UOM: {item.uom||"Each"}</span><span style={{display:"block",marginTop:4}}>Qty: {qtyText(item.qty)}</span><span style={{display:"block",marginTop:4}}>Moving Avg: {money(item.defaultRate)}</span><span style={{display:"block",marginTop:4}}>Book Value: {money(item.value)}</span></button>)}</div></section>}
      {selectedItem&&<><section className="panel"><div className="button-row" style={{justifyContent:"space-between"}}><button type="button" className="secondary" onClick={()=>setSelectedItemId("")}>← Back to Item List</button><Link prefetch={false} href={`/stock/item/${encodeURIComponent(selectedItem.itemId)}`}>Open Item Master</Link></div><h3 style={{marginTop:18}}>{selectedItem.itemCode} — {selectedItem.itemName}</h3><div className="document-meta" style={{marginTop:16}}><div><span>Type / UOM</span><strong>{selectedItem.itemType} / {selectedItem.uom||"Each"}</strong></div><div><span>Balance Qty</span><strong>{qtyText(selectedItem.qty)}</strong></div><div><span>Moving Average Rate</span><strong>{money(selectedItem.defaultRate)}</strong></div><div><span>Book Value</span><strong>{money(selectedItem.value)}</strong></div><div><span>Total Qty In</span><strong>{qtyText(selectedItem.qtyIn)}</strong></div><div><span>Total Qty Out</span><strong>{qtyText(selectedItem.qtyOut)}</strong></div><div><span>Revenue Account</span><strong>{selectedItem.revenueAccount||"—"}</strong></div><div><span>Cost / COGS Account</span><strong>{selectedItem.costAccount||"—"}</strong></div><div><span>Deferred Revenue Months</span><strong>{n(selectedItem.deferredRevenueMonths)||0}</strong></div></div></section><section className="panel table-wrap"><h3>Item Movement & Valuation Tracking</h3><table className="data-table"><thead><tr><th>Date</th><th>Movement</th><th>Type</th><th>Qty In</th><th>Qty Out</th><th>Rate</th><th>Value Change</th><th>Moving Avg After</th><th>Source</th><th>GL</th></tr></thead><tbody>{movements.filter(m=>String(m.itemId)===String(selectedItem.itemId)).length===0&&<tr><td colSpan={10}>No movements.</td></tr>}{[...movements].filter(m=>String(m.itemId)===String(selectedItem.itemId)).reverse().map(m=><tr key={m.movementId}><td>{m.movementDate}</td><td><button type="button" className="secondary" onClick={()=>openMovement(String(m.movementId))}>{m.movementType==="PURCHASE_RECEIPT"?receiptNumber(String(m.movementId)):m.movementId}</button></td><td>{m.movementType}</td><td>{qtyText(m.qtyIn)}</td><td>{qtyText(m.qtyOut)}</td><td>{money(m.unitCost)}</td><td>{money(signedValue(m))}</td><td><strong>{money(movementRates.get(String(m.movementId))||0)}</strong></td><td>{sourceLink(m)}</td><td>{m.journalId||"—"}</td></tr>)}</tbody></table></section></>}
    </>}

    {mode==="register"&&<>{selectedMovement?<section className="panel"><div className="button-row" style={{justifyContent:"space-between"}}><button type="button" className="secondary" onClick={()=>setSelectedMovementId("")}>← Back to Movement Register</button><span className="auto-badge">{selectedMovement.movementType}</span></div><h3 style={{marginTop:18}}>{selectedMovement.movementType==="PURCHASE_RECEIPT"?`Purchase Receipt ${receiptNumber(String(selectedMovement.movementId))}`:`Stock Movement ${selectedMovement.movementId}`}</h3><div className="document-meta" style={{marginTop:16}}><div><span>Movement Line</span><strong>{selectedMovement.movementId}</strong></div><div><span>Date</span><strong>{selectedMovement.movementDate}</strong></div><div><span>Item</span><strong><Link prefetch={false} href={`/stock/item/${encodeURIComponent(selectedMovement.itemId)}`}>{itemMap.get(String(selectedMovement.itemId))?.itemCode||selectedMovement.itemId}</Link></strong></div><div><span>Qty In / Out</span><strong>{qtyText(selectedMovement.qtyIn)} / {qtyText(selectedMovement.qtyOut)}</strong></div><div><span>Rate</span><strong>{money(selectedMovement.unitCost)}</strong></div><div><span>Value Change</span><strong>{money(signedValue(selectedMovement))}</strong></div><div><span>Moving Avg After</span><strong>{money(movementRates.get(String(selectedMovement.movementId))||0)}</strong></div><div><span>Source</span><strong>{sourceLink(selectedMovement)}</strong></div><div><span>Journal</span><strong>{selectedMovement.journalId||"—"}</strong></div></div></section>:<section className="panel table-wrap"><div className="form-title-row"><div><h3>Movement Register</h3><p className="small">Physical and value-only stock movements, source references and GL journal IDs.</p></div><span className="auto-badge">{movements.length} Lines</span></div><table className="data-table"><thead><tr><th>Date</th><th>Receipt / Movement</th><th>Type</th><th>Item</th><th>Qty In</th><th>Qty Out</th><th>Rate</th><th>Value Change</th><th>Moving Avg After</th><th>Source</th><th>GL</th></tr></thead><tbody>{[...movements].reverse().map(m=><tr key={m.movementId}><td>{m.movementDate}</td><td><button type="button" className="secondary" onClick={()=>openMovement(String(m.movementId))}>{m.movementType==="PURCHASE_RECEIPT"?receiptNumber(String(m.movementId)):m.movementId}</button></td><td>{m.movementType}</td><td><Link prefetch={false} href={`/stock/item/${encodeURIComponent(m.itemId)}`}>{itemMap.get(String(m.itemId))?.itemCode||m.itemId}</Link></td><td>{qtyText(m.qtyIn)}</td><td>{qtyText(m.qtyOut)}</td><td>{money(m.unitCost)}</td><td>{money(signedValue(m))}</td><td><strong>{money(movementRates.get(String(m.movementId))||0)}</strong></td><td>{sourceLink(m)}</td><td>{m.journalId||"—"}</td></tr>)}</tbody></table></section>}</>}
  </>;
}
