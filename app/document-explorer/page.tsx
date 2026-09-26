"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ExplorerRow={
  kind:string;
  number:string;
  status?:string;
  amount?:number|null;
  outstanding?:number;
  href:string;
  direction?:string;
};

function money(value:unknown){
  return new Intl.NumberFormat("en-PG",{style:"currency",currency:"PGK",minimumFractionDigits:2}).format(Number(value||0));
}

const DOCUMENT_TYPES=[
  {value:"quote",label:"Sales Quotation / Sales Order"},
  {value:"invoice",label:"Sales Invoice / Credit Note"},
  {value:"purchaseOrder",label:"Supplier Quotation / Purchase Order"},
  {value:"supplierBill",label:"Supplier Invoice"},
  {value:"payment",label:"Payment / Advance / Receipt"},
];

export default function DocumentExplorerPage(){
  const[rows,setRows]=useState<ExplorerRow[]>([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[query,setQuery]=useState("");
  const[typeFilter,setTypeFilter]=useState("ALL");
  const[statusFilter,setStatusFilter]=useState("ALL");
  const[page,setPage]=useState(1);
  const[partyType,setPartyType]=useState("customer");
  const[partyId,setPartyId]=useState("");
  const[documentType,setDocumentType]=useState("quote");
  const[documentId,setDocumentId]=useState("");
  const[contextLabel,setContextLabel]=useState("No relationship loaded");
  const pageSize=25;

  async function loadParty(nextPartyType=partyType,nextPartyId=partyId){
    const cleanId=nextPartyId.trim();
    if(!cleanId){setError("Customer / Supplier ID is required");return;}
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/erp/party-financial-summary?type=${encodeURIComponent(nextPartyType)}&partyId=${encodeURIComponent(cleanId)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Party document history load failed");
      setRows(Array.isArray(body.documents)?body.documents:[]);
      setContextLabel(`${nextPartyType==="customer"?"Customer":"Supplier"} · ${cleanId}`);
      setQuery("");setTypeFilter("ALL");setStatusFilter("ALL");setPage(1);
    }catch(reason){setError(reason instanceof Error?reason.message:"Party document history load failed");}
    finally{setLoading(false);}
  }

  async function loadDocument(nextDocumentType=documentType,nextDocumentId=documentId){
    const cleanId=nextDocumentId.trim();
    if(!cleanId){setError("Document number or record ID is required");return;}
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/erp/transaction-document?type=${encodeURIComponent(nextDocumentType)}&id=${encodeURIComponent(cleanId)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Document relationship load failed");
      const current=body.record||{};
      const resolvedId=String(body.id||cleanId);
      const currentNumber=String(body.number||current.quoteNumber||current.invoiceNumber||current.poNumber||current.billNumber||current.paymentNumber||cleanId);
      const currentStatus=String(current.status||"");
      const mapped:ExplorerRow[]=(body.documentLinks||[]).map((row:any)=>({
        kind:row.label,
        number:String(row.number||row.id||""),
        status:"",
        amount:null,
        href:String(row.href||"#"),
        direction:row.direction,
      }));
      setRows([{
        kind:"Current Document",
        number:currentNumber,
        status:currentStatus,
        amount:Number(current.totalAmount??current.amount??0),
        outstanding:current.outstandingAmount===undefined?undefined:Number(current.outstandingAmount),
        href:`/transactions/${nextDocumentType}/${encodeURIComponent(resolvedId)}`,
      },...mapped]);
      const label=DOCUMENT_TYPES.find(row=>row.value===nextDocumentType)?.label||"Document";
      setContextLabel(`${label} · ${currentNumber}`);
      setDocumentId(currentNumber);
      setQuery("");setTypeFilter("ALL");setStatusFilter("ALL");setPage(1);
    }catch(reason){setError(reason instanceof Error?reason.message:"Document relationship load failed");}
    finally{setLoading(false);}
  }

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const initialPartyType=params.get("partyType")||"";
    const initialPartyId=params.get("partyId")||"";
    const initialDocumentType=params.get("documentType")||"";
    const initialDocumentId=params.get("documentId")||"";
    if(initialPartyType&&initialPartyId){
      setPartyType(initialPartyType);
      setPartyId(initialPartyId);
      void loadParty(initialPartyType,initialPartyId);
      return;
    }
    if(initialDocumentType&&initialDocumentId){
      setDocumentType(initialDocumentType);
      setDocumentId(initialDocumentId);
      void loadDocument(initialDocumentType,initialDocumentId);
    }
  // Initial URL context only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const types=useMemo(()=>Array.from(new Set(rows.map(row=>row.kind).filter(Boolean))).sort(),[rows]);
  const statuses=useMemo(()=>Array.from(new Set(rows.map(row=>row.status||"").filter(Boolean))).sort(),[rows]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return rows.filter(row=>{
      if(typeFilter!=="ALL"&&row.kind!==typeFilter)return false;
      if(statusFilter!=="ALL"&&row.status!==statusFilter)return false;
      if(!q)return true;
      return [row.kind,row.number,row.status,row.amount,row.outstanding,row.direction].some(value=>String(value??"").toLowerCase().includes(q));
    });
  },[rows,query,typeFilter,statusFilter]);

  useEffect(()=>setPage(1),[query,typeFilter,statusFilter]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
  const visible=filtered.slice((page-1)*pageSize,page*pageSize);

  function submitParty(event:FormEvent){event.preventDefault();void loadParty();}
  function submitDocument(event:FormEvent){event.preventDefault();void loadDocument();}

  return <div className="document-explorer-page">
    <div className="page-head">
      <div>
        <h2>Document Relationship Explorer</h2>
        <p className="small">Central audit view for sales, purchase, advance, invoice, receipt and payment relationships.</p>
      </div>
      <Link className="button-link secondary-link" href="/transactions">Back to Transactions</Link>
    </div>

    {error&&<div className="status-banner error">{error}</div>}

    <section className="panel relationship-search-panel">
      <div className="form-title-row">
        <div><h3>Find Relationship</h3><p className="small">Open a party history or search directly by a document number / record ID.</p></div>
        <span className="auto-badge">{contextLabel}</span>
      </div>

      <div className="relationship-search-grid">
        <form onSubmit={submitParty} className="relationship-search-card">
          <strong>Customer / Supplier History</strong>
          <select value={partyType} onChange={e=>setPartyType(e.target.value)}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
          </select>
          <input value={partyId} onChange={e=>setPartyId(e.target.value)} placeholder="Customer / Supplier ID" />
          <button type="submit" disabled={loading}>{loading?"Loading…":"Open Party History"}</button>
        </form>

        <form onSubmit={submitDocument} className="relationship-search-card">
          <strong>Document Relationship</strong>
          <select value={documentType} onChange={e=>setDocumentType(e.target.value)}>
            {DOCUMENT_TYPES.map(row=><option key={row.value} value={row.value}>{row.label}</option>)}
          </select>
          <input value={documentId} onChange={e=>setDocumentId(e.target.value)} placeholder="Document number or record ID" />
          <button type="submit" disabled={loading}>{loading?"Loading…":"Open Document Chain"}</button>
        </form>
      </div>
    </section>

    <section className="panel">
      <div className="form-title-row">
        <div><h3>Linked Documents</h3><p className="small">Filter the loaded relationship without crowding Customer, Supplier or transaction screens.</p></div>
        <span className="auto-badge">{loading?"LOADING":`${filtered.length} OF ${rows.length}`}</span>
      </div>

      <div className="party-document-toolbar">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search document number, type, status or amount…" />
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="ALL">All document types</option>
          {types.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {statuses.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        {(query||typeFilter!=="ALL"||statusFilter!=="ALL")&&<button className="secondary" type="button" onClick={()=>{setQuery("");setTypeFilter("ALL");setStatusFilter("ALL");}}>Clear filters</button>}
      </div>

      <div className="table-wrap party-document-table">
        <table className="data-table">
          <thead><tr><th>Relationship / Type</th><th>Document</th><th>Status</th><th>Amount</th><th>Outstanding</th></tr></thead>
          <tbody>{visible.length?visible.map((row,index)=><tr key={`${row.href}-${row.number}-${(page-1)*pageSize+index}`}>
            <td>{row.direction?<span className="small">{row.direction==="previous"?"Previous":"Next"}{" · "}</span>:null}{row.kind}</td>
            <td><Link href={row.href}><strong>{row.number}</strong></Link></td>
            <td>{row.status||"—"}</td>
            <td>{row.amount===null||row.amount===undefined?"—":money(row.amount)}</td>
            <td>{row.outstanding===undefined?"—":money(row.outstanding)}</td>
          </tr>):<tr><td colSpan={5}>{loading?"Loading linked documents…":"No linked documents loaded."}</td></tr>}</tbody>
        </table>
      </div>

      <div className="party-document-pagination">
        <span className="small">{filtered.length?`Showing ${(page-1)*pageSize+1}–${Math.min(page*pageSize,filtered.length)} of ${filtered.length}`:"No results"}</span>
        <div className="button-row">
          <button className="secondary" type="button" disabled={page<=1} onClick={()=>setPage(v=>Math.max(1,v-1))}>Previous</button>
          <span className="auto-badge">Page {page} / {pageCount}</span>
          <button className="secondary" type="button" disabled={page>=pageCount} onClick={()=>setPage(v=>Math.min(pageCount,v+1))}>Next</button>
        </div>
      </div>
    </section>
  </div>;
}
