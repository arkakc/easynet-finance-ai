"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Warehouse={warehouseId:string;warehouseCode:string;warehouseName:string;isDefault?:boolean};

function localDate(plusDays=0){
  const date=new Date();
  date.setDate(date.getDate()+plusDays);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return String(v.year)+"-"+String(v.month)+"-"+String(v.day);
}

export default function DeliveryNoteClient({id}:{id:string}){
  const router=useRouter();
  const[note,setNote]=useState<any|null>(null);
  const[warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const[warehouseId,setWarehouseId]=useState("");
  const[deliveryDate,setDeliveryDate]=useState(localDate());
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");
  const[documentLinks,setDocumentLinks]=useState<any[]>([]);

  async function load(){
    setLoading(true);
    try{
      const response=await fetch("/api/erp/sales-delivery-note?id="+encodeURIComponent(id),{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Delivery Note load failed");
      const row=body.deliveryNote;
      setNote(row);
      setDeliveryDate(String(row.deliveryDate||localDate()));
      setWarehouseId(String(row.warehouseId||""));
      const [warehouseResponse,flowResponse]=await Promise.all([
        fetch("/api/erp/warehouse-options",{cache:"no-store"}),
        fetch("/api/erp/transaction-document?type=quote&id="+encodeURIComponent(String(row.salesOrderId||"")),{cache:"no-store"}),
      ]);
      const [warehouseBody,flowBody]=await Promise.all([warehouseResponse.json(),flowResponse.json()]);
      if(warehouseResponse.ok&&warehouseBody.ok){
        const options=warehouseBody.warehouses||[];
        setWarehouses(options);
        setWarehouseId(current=>current||String((options.find((w:any)=>w.isDefault)||options[0])?.warehouseId||""));
      }
      if(flowResponse.ok&&flowBody.ok)setDocumentLinks(Array.isArray(flowBody.documentLinks)?flowBody.documentLinks:[]);
    }catch(error){setMessage(error instanceof Error?error.message:"Delivery Note load failed");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[id]);

  async function approve(){
    if(!note||busy||!warehouseId)return;
    setBusy("approve");setMessage("Approving Delivery Note and posting Stock Out / COGS…");
    try{
      const response=await fetch("/api/erp/sales-delivery-note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approve",deliveryId:note.deliveryId,warehouseId,deliveryDate})});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Delivery Note approval failed");
      setMessage(body.message||"Delivery Note approved.");
      await load();
      router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Delivery Note approval failed");}
    finally{setBusy("");}
  }

  async function createInvoice(){
    if(!note||busy||String(note.status||"").toUpperCase()!=="POSTED")return;
    setBusy("invoice");setMessage("Creating Sales Invoice from delivered Sales Order…");
    try{
      const response=await fetch("/api/erp/sales-invoice-conversion",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quoteId:note.salesOrderId,mode:"FULL",invoiceDate:localDate(),dueDate:localDate(30)})});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Sales Invoice conversion failed");
      window.location.assign("/transactions/invoice/"+encodeURIComponent(body.createdId)+"?returnModule=sales&returnTab=deliveryNote&returnMode=list");
    }catch(error){setMessage(error instanceof Error?error.message:"Sales Invoice conversion failed");setBusy("");}
  }

  if(loading)return <section className="panel"><strong>Loading Delivery Note…</strong></section>;
  if(!note)return <section className="panel warning-panel"><strong>Delivery Note unavailable.</strong>{message&&<p>{message}</p>}</section>;

  const status=String(note.status||"DRAFT").toUpperCase();
  const posted=status==="POSTED";
  const linkedInvoice=documentLinks.find((link:any)=>Number(link.stage||0)===40)||null;
  const linksByStage=new Map<number,any[]>();
  linksByStage.set(20,[{id:note.salesOrderId,number:note.salesOrderNumber||note.salesOrderId,href:"/transactions/quote/"+encodeURIComponent(note.salesOrderId),type:"quote",stage:20}]);
  for(const link of documentLinks){
    const stage=Number(link.stage||0);
    const list=linksByStage.get(stage)||[];
    list.push(link);
    linksByStage.set(stage,list);
  }
  const flowStages=[
    {stage:10,label:"Sales Quotation"},
    {stage:15,label:"Customer Advance"},
    {stage:20,label:"Sales Order"},
    {stage:30,label:"Delivery Note"},
    {stage:40,label:"Sales Invoice"},
    {stage:45,label:"Credit Note"},
    {stage:50,label:"Final Receipt"},
  ];

  return <div className="document-page">
    <div className="document-toolbar no-print"><div className="document-toolbar-back"><Link href="/transactions?module=sales&tab=deliveryNote&mode=list">← Back to Delivery Notes</Link></div></div>
    <section className="document-sheet">
      <header className="document-header">
        <div className="document-header-main">
          <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
          <h1>Delivery Note / Stock Out</h1>
          <div className="document-header-subline"><span className="document-number">{note.deliveryNumber}</span><span className="document-type-note">Finance document</span></div>
        </div>
        <div className={"status-pill status-"+status.toLowerCase()}>{status}</div>
      </header>

      <section className="document-flow-tabs no-print">
        <div className="document-flow-tabs-head">
          <div><span className="document-section-kicker">Workflow</span><strong>Document Flow</strong></div>
          <Link className="document-flow-explorer-link" href={"/document-explorer?documentId="+encodeURIComponent(note.deliveryNumber)}>View Full Relationship</Link>
        </div>
        <div className="document-flow-tab-row">
          {flowStages.map((stageDef,index)=>{
            const stageLinks=linksByStage.get(stageDef.stage)||[];
            const isCurrent=stageDef.stage===30;
            const visibleStageLinks=isCurrent?stageLinks.filter((link:any)=>String(link.id||"")!==String(note.deliveryId||"")&&String(link.number||"")!==String(note.deliveryNumber||"")):stageLinks;
            return <div className="document-flow-stage-wrap" key={stageDef.stage}>
              <div className={"document-flow-tab "+(isCurrent?"current":visibleStageLinks.length?"linked":"empty")}>
                <span className="document-flow-tab-label">{stageDef.label}</span>
                <div className="document-flow-tab-links">
                  {isCurrent&&<span className="document-flow-current-number">{note.deliveryNumber}</span>}
                  {visibleStageLinks.map((link:any,linkIndex:number)=><Link key={String(link.type)+"-"+String(link.id)+"-"+linkIndex} href={String(link.href||"#")}>{link.number||link.id}</Link>)}
                  {!isCurrent&&visibleStageLinks.length===0&&<span className="document-flow-placeholder">—</span>}
                </div>
              </div>
              {index<flowStages.length-1&&<span className="document-flow-mini-arrow">→</span>}
            </div>;
          })}
        </div>
      </section>

      <div className="document-section-heading"><div><span className="document-section-kicker">Overview</span><h2>Delivery details</h2></div></div>
      <div className="document-meta">
        <div><span>Source Sales Order</span><strong><Link href={"/transactions/quote/"+encodeURIComponent(note.salesOrderId)}>{note.salesOrderId}</Link></strong></div>
        <div><span>Customer</span><strong>{note.customerName?note.customerName+" ("+note.customerId+")":note.customerId||"—"}</strong></div>
        <div><span>Project</span><strong>{note.projectName?note.projectName+" ("+note.projectId+")":note.projectId||"—"}</strong></div>
        <div><span>Delivery Date</span><strong>{note.deliveryDate}</strong></div>
        {note.journalId&&<div><span>COGS Journal</span><strong><Link href={"/journals/"+encodeURIComponent(note.journalId)}>{note.journalId}</Link></strong></div>}
      </div>

      <div className="document-section-heading"><div><span className="document-section-kicker">Items</span><h2>Line items</h2></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>Type</th><th>UOM</th><th>Qty</th></tr></thead><tbody>
        {(note.lines||[]).map((line:any,index:number)=><tr key={line.lineId||line.itemId||index}><td>{index+1}</td><td>{line.itemCode||line.itemId}</td><td>{line.itemName||line.description}</td><td>{line.itemType}</td><td>{line.uom}</td><td>{Number(line.qty||0).toFixed(4)}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="conversion-box no-print" style={{marginTop:16}}>
      <div className="form-title-row"><div><strong>Delivery Note Actions</strong><p className="small">{posted?"Stock Out / COGS is posted. You can now create the Sales Invoice.":"Draft only. No stock or ledger effect until approval."}</p></div><span className="auto-badge">{status}</span></div>
      {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
      {!posted&&<div className="form-grid" style={{marginTop:14}}>
        <label>Delivery Date<input type="date" value={deliveryDate} onChange={e=>setDeliveryDate(e.target.value)} disabled={Boolean(busy)}/></label>
        <label>Fulfil From Warehouse<select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} required disabled={Boolean(busy)}><option value="">Select warehouse</option>{warehouses.map(row=><option key={row.warehouseId} value={row.warehouseId}>{row.warehouseCode+" — "+row.warehouseName}</option>)}</select></label>
      </div>}
      <div className="button-row" style={{marginTop:14}}>
        {!posted&&<button type="button" disabled={Boolean(busy)||!warehouseId} onClick={()=>void approve()}>{busy==="approve"?"Posting Stock Out…":"Approve & Post Stock Out"}</button>}
        {posted&&(linkedInvoice?<Link className="button-link" href={String(linkedInvoice.href||"#")}>Open Sales Invoice</Link>:<button type="button" disabled={Boolean(busy)} onClick={()=>void createInvoice()}>{busy==="invoice"?"Creating Sales Invoice…":"Create Sales Invoice"}</button>)}
      </div>
    </section>
  </div>;
}
