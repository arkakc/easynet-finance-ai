"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ExplorerRow={kind:string;number:string;status?:string;amount?:number|null;outstanding?:number;href:string;direction?:string;label?:string;id?:string;type?:string};

function money(value:unknown){return new Intl.NumberFormat("en-PG",{style:"currency",currency:"PGK",minimumFractionDigits:2}).format(Number(value||0));}

export default function DocumentExplorerPage(){
  const[rows,setRows]=useState<ExplorerRow[]>([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[query,setQuery]=useState("");
  const[typeFilter,setTypeFilter]=useState("ALL");
  const[statusFilter,setStatusFilter]=useState("ALL");
  const[page,setPage]=useState(1);
  const pageSize=25;

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const partyType=params.get("partyType")||"";
    const partyId=params.get("partyId")||"";
    const documentType=params.get("documentType")||"";
    const documentId=params.get("documentId")||"";
    if(!partyId&&!documentId)return;
    setLoading(true);setError("");
    void(async()=>{
      try{
        if(partyId&&partyType){
          const response=await fetch(`/api/erp/party-financial-summary?type=${encodeURIComponent(partyType)}&partyId=${encodeURIComponent(partyId)}`,{cache:"no-store"});
          const body=await response.json();
          if(!response.ok||!body.ok)throw new Error(body.error||"Document history load failed");
          setRows(Array.isArray(body.documents)?body.documents:[]);
        }else{
          const response=await fetch(`/api/erp/transaction-document?type=${encodeURIComponent(documentType)}&id=${encodeURIComponent(documentId)}`,{cache:"no-store"});
          const body=await response.json();
          if(!response.ok||!body.ok)throw new Error(body.error||"Document relationship load failed");
          const current=body.record||{};
          const currentNumber=String(current.quoteNumber||current.invoiceNumber||current.poNumber||current.billNumber||current.paymentNumber||documentId);
          const currentStatus=String(current.status||"");
          const mapped=(body.documentLinks||[]).map((row:any)=>({kind:row.label,number:row.number||row.id,status:"",amount:null,href:row.href,direction:row.direction,label:row.label,id:row.id,type:row.type}));
          setRows([{kind:"Current Document",number:currentNumber,status:currentStatus,amount:Number(current.totalAmount??current.amount??0),href:window.location.pathname.includes("/document-explorer")?`/transactions/${documentType}/${encodeURIComponent(documentId)}`:"#"},...mapped]);
        }
      }catch(reason){setError(reason instanceof Error?reason.message:"Document relationship load failed");}
      finally{setLoading(false);}
    })();
  },[]);

  const types=useMemo(()=>Array.from(new Set(rows.map(row=>row.kind).filter(Boolean))).sort(),[rows]);
  const statuses=useMemo(()=>Array.from(new Set(rows.map(row=>row.status||"").filter(Boolean))).sort(),[rows]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return rows.filter(row=>{
      if(typeFilter!=="ALL"&&row.kind!==typeFilter)return false;
      if(statusFilter!=="ALL"&&row.status!==statusFilter)return false;
      if(!q)return true;
      return [row.kind,row.number,row.status,row.amount,row.outstanding].some(value=>String(value??"").toLowerCase().includes(q));
    });
  },[rows,query,typeFilter,statusFilter]);
  useEffect(()=>setPage(1),[query,typeFilter,statusFilter]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
  const visible=filtered.slice((page-1)*pageSize,page*pageSize);

  return <div className="document-explorer-page">
    <div className="page-head">
      <div><h2>Document Relationship Explorer</h2><p className="small">A dedicated audit view for linked sales, purchase, advance, invoice and payment documents.</p></div>
      <Link className="button-link secondary-link" href="/transactions">Back to Transactions</Link>
    </div>
    {error&&<div className="status-banner error">{error}</div>}
    <section className="panel">
      <div className="form-title-row"><div><h3>Linked Documents</h3><p className="small">Search and filter without loading relationship history into every master or transaction screen.</p></div><span className="auto-badge">{loading?"LOADING":`${filtered.length} OF ${rows.length}`}</span></div>
      <div className="party-document-toolbar">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search document number, type, status or amount…" />
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="ALL">All document types</option>{types.map(v=><option key={v} value={v}>{v}</option>)}</select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{statuses.map(v=><option key={v} value={v}>{v}</option>)}</select>
        {(query||typeFilter!=="ALL"||statusFilter!=="ALL")&&<button className="secondary" type="button" onClick={()=>{setQuery("");setTypeFilter("ALL");setStatusFilter("ALL");}}>Clear filters</button>}
      </div>
      <div className="table-wrap party-document-table">
        <table className="data-table">
          <thead><tr><th>Relationship / Type</th><th>Document</th><th>Status</th><th>Amount</th><th>Outstanding</th></tr></thead>
          <tbody>{visible.length?visible.map((row,index)=><tr key={`${row.href}-${row.number}-${(page-1)*pageSize+index}`}><td>{row.direction?<span className="small">{row.direction==="previous"?"Previous"}{" · "}</span>:null}{row.kind}</td><td><Link href={row.href}><strong>{row.number}</strong></Link></td><td>{row.status||"—"}</td><td>{row.amount===null||row.amount===undefined?"—":money(row.amount)}</td><td>{row.outstanding===undefined?"—":money(row.outstanding)}</td></tr>):<tr><td colSpan={5}>{loading?"Loading linked documents…":"No linked documents found."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="party-document-pagination"><span className="small">{filtered.length?`Showing ${(page-1)*pageSize+1}–${Math.min(page*pageSize,filtered.length)} of ${filtered.length}`:"No results"}</span><div className="button-row"><button className="secondary" type="button" disabled={page<=1} onClick={()=>setPage(v=>Math.max(1,v-1))}>Previous</button><span className="auto-badge">Page {page} / {pageCount}</span><button className="secondary" type="button" disabled={page>=pageCount} onClick={()=>setPage(v=>Math.min(pageCount,v+1))}>Next</button></div></div>
    </section>
  </div>;
}
