"use client";

import Link from "next/link";
import LinkedDocumentReference from "@/app/components/linked-document-reference";
import { useEffect, useState } from "react";

type Warehouse={warehouseId:string;warehouseCode:string;warehouseName:string;isDefault?:boolean};

function localDate(plusDays=0){
  const date=new Date();
  date.setDate(date.getDate()+plusDays);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return String(v.year)+"-"+String(v.month)+"-"+String(v.day);
}

export default function PurchaseReceiptClient({id}:{id:string}){
  const[receipt,setReceipt]=useState<any|null>(null);
  const[warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const[warehouseId,setWarehouseId]=useState("");
  const[receiptDate,setReceiptDate]=useState(localDate());
  const[quantities,setQuantities]=useState<Record<string,string>>({});
  const[documentLinks,setDocumentLinks]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");

  async function load(){
    setLoading(true);
    try{
      const response=await fetch("/api/erp/purchase-receipt?id="+encodeURIComponent(id),{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Purchase Receipt / GRN load failed");
      const row=body.purchaseReceipt;
      setReceipt(row);
      setReceiptDate(String(row.receiptDate||localDate()));
      setWarehouseId(String(row.warehouseId||""));
      setQuantities(Object.fromEntries((row.lines||[]).map((line:any)=>[String(line.itemId),String(line.qty??line.remainingQty??0)])));

      const [warehouseResponse,flowResponse]=await Promise.all([
        fetch("/api/erp/warehouse-options",{cache:"no-store"}),
        fetch("/api/erp/transaction-document?type=purchaseOrder&id="+encodeURIComponent(String(row.purchaseOrderId||"")),{cache:"no-store"}),
      ]);
      const [warehouseBody,flowBody]=await Promise.all([warehouseResponse.json(),flowResponse.json()]);
      if(warehouseResponse.ok&&warehouseBody.ok){
        const options=warehouseBody.warehouses||[];
        setWarehouses(options);
        setWarehouseId(current=>current||String((options.find((w:any)=>w.isDefault)||options[0])?.warehouseId||""));
      }
      if(flowResponse.ok&&flowBody.ok)setDocumentLinks(Array.isArray(flowBody.documentLinks)?flowBody.documentLinks:[]);
    }catch(error){setMessage(error instanceof Error?error.message:"Purchase Receipt / GRN load failed");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[id]);

  async function completeReceipt(){
    if(!receipt||busy||!warehouseId)return;
    const lines=(receipt.lines||[]).map((line:any)=>({itemId:String(line.itemId),qty:Number(quantities[String(line.itemId)]||0)})).filter((line:any)=>line.qty>0);
    if(!lines.length){setMessage("Enter receipt quantity for at least one stock item.");return;}
    for(const line of receipt.lines||[]){
      const qty=Number(quantities[String(line.itemId)]||0);
      const max=Number(line.remainingQty??line.qty??0);
      if(qty>max+0.0001){setMessage("Receipt quantity cannot exceed remaining Purchase Order quantity.");return;}
    }
    setBusy("approve");setMessage("Submitting Purchase Receipt / GRN and posting Stock In / GRNI…");
    try{
      const response=await fetch("/api/erp/purchase-receipt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approve",receiptId:receipt.receiptId,warehouseId,receiptDate,lines})});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Purchase Receipt completion failed");
      setMessage(body.message||"Purchase Receipt / GRN submitted.");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Purchase Receipt completion failed");}
    finally{setBusy("");}
  }

  async function createSupplierInvoice(){
    if(!receipt||busy||String(receipt.status||"").toUpperCase()!=="POSTED")return;
    setBusy("invoice");setMessage("Creating Draft Supplier Invoice from submitted Purchase Receipt / GRN…");
    try{
      const response=await fetch("/api/erp/conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"poToBill",payload:{poId:receipt.purchaseOrderId,billDate:localDate(),dueDate:localDate(30),costAccountId:"ACC-5100"}})});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Supplier Invoice conversion failed");
      const createdId=body.createdId||body.result?.recordId||body.result?.billId;
      if(!createdId)throw new Error("Supplier Invoice was created but no document ID was returned");
      window.location.assign("/transactions/supplierBill/"+encodeURIComponent(createdId)+"?returnModule=purchase&returnTab=purchaseReceipt&returnMode=list");
    }catch(error){setMessage(error instanceof Error?error.message:"Supplier Invoice conversion failed");setBusy("");}
  }

  if(loading)return <section className="panel"><strong>Loading Purchase Receipt / GRN…</strong></section>;
  if(!receipt)return <section className="panel warning-panel"><strong>Purchase Receipt / GRN unavailable.</strong>{message&&<p>{message}</p>}</section>;

  const status=String(receipt.status||"DRAFT").toUpperCase();
  const submitted=status==="POSTED"||status==="SUBMITTED";
  const linkedInvoice=documentLinks.find((link:any)=>Number(link.stage||0)===40)||null;
  const linksByStage=new Map<number,any[]>();
  linksByStage.set(20,[{id:receipt.purchaseOrderId,number:receipt.purchaseOrderNumber||receipt.purchaseOrderId,href:"/transactions/purchaseOrder/"+encodeURIComponent(receipt.purchaseOrderId),type:"purchaseOrder",stage:20}]);
  for(const link of documentLinks){
    const stage=Number(link.stage||0);
    const list=linksByStage.get(stage)||[];
    list.push(link);linksByStage.set(stage,list);
  }
  const stages=[
    {stage:10,label:"Supplier Quotation"},
    {stage:20,label:"Purchase Order"},
    {stage:25,label:"Supplier Advance"},
    {stage:30,label:"Purchase Receipt / GRN"},
    {stage:40,label:"Supplier Invoice"},
    {stage:50,label:"Final Payment"},
  ];

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <div className="document-toolbar-back">
        <Link href="/transactions?module=purchase&tab=purchaseReceipt&mode=list">← Back to Purchase Receipts / GRN</Link>
      </div>
      <div className="row-actions">
        {submitted&&!linkedInvoice&&(
          <button type="button" disabled={Boolean(busy)} onClick={()=>void createSupplierInvoice()}>
            {busy==="invoice"?"Creating Supplier Invoice…":"Create Supplier Invoice"}
          </button>
        )}
        {submitted&&linkedInvoice&&(
          <Link className="button-link" href={String(linkedInvoice.href||"#")}>Open Supplier Invoice</Link>
        )}
      </div>
    </div>
    <section className="document-sheet">
      <header className="document-header">
        <div className="document-header-main">
          <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
          <h1>Purchase Receipt / GRN</h1>
          <div className="document-header-subline"><span className="document-number">{receipt.receiptNumber}</span><span className="document-type-note">Finance document</span></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {receipt.journalId&&<Link className="button-link secondary-link no-print" href={"/journals/"+encodeURIComponent(receipt.journalId)}>Journal Entry · {receipt.journalId}</Link>}
          <div className={"status-pill status-"+(submitted?"submitted":status.toLowerCase())}>{submitted?"SUBMITTED":status}</div>
        </div>
      </header>

      <section className="document-flow-tabs no-print">
        <div className="document-flow-tabs-head"><div><span className="document-section-kicker">Workflow</span><strong>Document Flow</strong></div><Link className="document-flow-explorer-link" href={"/document-explorer?documentId="+encodeURIComponent(receipt.receiptNumber)}>View Full Relationship</Link></div>
        <div className="document-flow-tab-row">
          {stages.map((stageDef,index)=>{
            const stageLinks=linksByStage.get(stageDef.stage)||[];
            const isCurrent=stageDef.stage===30;
            const visible=isCurrent?stageLinks.filter((link:any)=>String(link.id||"")!==String(receipt.receiptId||"")&&String(link.number||"")!==String(receipt.receiptNumber||"")):stageLinks;
            return <div className="document-flow-stage-wrap" key={stageDef.stage}>
              <div className={"document-flow-tab "+(isCurrent?"current":visible.length?"linked":"empty")}>
                <span className="document-flow-tab-label">{stageDef.label}</span>
                <div className="document-flow-tab-links">
                  {isCurrent&&<span className="document-flow-current-number">{receipt.receiptNumber}</span>}
                  {visible.map((link:any,i:number)=><Link key={String(link.type)+"-"+String(link.id)+"-"+i} href={String(link.href||"#")}>{link.number||link.id}</Link>)}
                  {!isCurrent&&visible.length===0&&<span className="document-flow-placeholder">—</span>}
                </div>
              </div>
              {index<stages.length-1&&<span className="document-flow-mini-arrow">→</span>}
            </div>;
          })}
        </div>
      </section>

      <div className="document-section-heading"><div><span className="document-section-kicker">Overview</span><h2>Receipt details</h2></div></div>
      <div className="document-meta">
        <div><span>Source Purchase Order</span><strong><LinkedDocumentReference kind="purchaseOrder" id={receipt.purchaseOrderId}>{receipt.purchaseOrderNumber||receipt.purchaseOrderId}</LinkedDocumentReference></strong></div>
        <div><span>Supplier</span><strong>{receipt.supplierName?receipt.supplierName+" ("+receipt.supplierId+")":receipt.supplierId||"—"}</strong></div>
        <div><span>Project</span><strong>{receipt.projectName?receipt.projectName+" ("+receipt.projectId+")":receipt.projectId||"—"}</strong></div>
        <div><span>Receipt Date</span><strong>{receipt.receiptDate}</strong></div>
        {receipt.journalId&&<div><span>Inventory / GRNI Journal</span><strong><LinkedDocumentReference kind="journal" id={receipt.journalId} /></strong></div>}
      </div>

      <div className="document-section-heading"><div><span className="document-section-kicker">Items</span><h2>Receipt lines</h2></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th>Ordered</th><th>Already Received</th><th>Remaining</th><th>{submitted?"Received":"Receive Now"}</th></tr></thead><tbody>
        {(receipt.lines||[]).map((line:any,index:number)=>{
          const max=Number(line.remainingQty??line.qty??0);
          return <tr key={line.lineId||line.itemId||index}><td>{index+1}</td><td>{line.itemCode||line.itemId}</td><td>{line.itemName||line.description}</td><td>{line.uom}</td><td>{Number(line.orderedQty??line.qty??0).toFixed(4)}</td><td>{Number(line.alreadyReceivedQty||0).toFixed(4)}</td><td>{submitted?"—":max.toFixed(4)}</td><td>{submitted?Number(line.qty||0).toFixed(4):<input type="number" min="0" max={max} step="0.0001" value={quantities[String(line.itemId)]??String(max)} onChange={e=>setQuantities(current=>({...current,[String(line.itemId)]:e.target.value}))} disabled={Boolean(busy)}/>}</td></tr>;
        })}
      </tbody></table></div>
    </section>

    {!submitted&&<section className="conversion-box no-print" style={{marginTop:16}}>
      <div className="form-title-row"><div><strong>Purchase Receipt / GRN Actions</strong><p className="small">Draft only. No stock or ledger effect until the receipt is completed.</p></div><span className="auto-badge">{status}</span></div>
      {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
      <div className="form-grid" style={{marginTop:14}}>
        <label>Receipt Date<input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)} disabled={Boolean(busy)}/></label>
        <label>Receive Into Warehouse<select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} required disabled={Boolean(busy)}><option value="">Select warehouse</option>{warehouses.map(row=><option key={row.warehouseId} value={row.warehouseId}>{row.warehouseCode+" — "+row.warehouseName}</option>)}</select></label>
      </div>
      <div className="button-row" style={{marginTop:14}}>
        <button type="button" disabled={Boolean(busy)||!warehouseId} onClick={()=>void completeReceipt()}>{busy==="approve"?"Posting Stock In…":"Complete Purchase Receipt / GRN"}</button>
      </div>
    </section>}
    {submitted&&message&&<div className="status-banner no-print" style={{marginTop:16}}>{message}</div>}
  </div>;
}
