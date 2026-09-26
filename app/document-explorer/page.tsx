"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import SearchableSelect, { type SearchableSelectOption } from "@/app/components/searchable-select";

type ExplorerRow={
  kind:string;
  number:string;
  status?:string;
  amount?:number|null;
  outstanding?:number;
  href:string;
  direction?:string;
  date?:string;
  chainId?:string;
};

type Side="sales"|"purchase";

const DOCUMENT_TYPES=[
  {value:"quote",label:"Sales Quotation / Sales Order",side:"sales" as Side},
  {value:"invoice",label:"Sales Invoice / Credit Note",side:"sales" as Side},
  {value:"purchaseOrder",label:"Supplier Quotation / Purchase Order",side:"purchase" as Side},
  {value:"supplierBill",label:"Supplier Invoice",side:"purchase" as Side},
  {value:"payment",label:"Payment / Advance / Receipt",side:"sales" as Side},
];

function money(value:unknown){
  return new Intl.NumberFormat("en-PG",{style:"currency",currency:"PGK",minimumFractionDigits:2}).format(Number(value||0));
}

function shortDate(value:unknown){
  const raw=String(value||"").trim();
  if(!raw)return "—";
  const date=new Date(raw);
  if(Number.isNaN(date.getTime()))return raw.slice(0,10);
  return date.toLocaleDateString("en-PG",{day:"2-digit",month:"short",year:"numeric"});
}

function stageFor(kind:string,side:Side){
  const value=kind.toLowerCase();
  if(side==="sales"){
    if(value.includes("quotation"))return "quote";
    if(value.includes("sales order"))return "order";
    if(value.includes("delivery"))return "delivery";
    if(value.includes("invoice")||value.includes("credit note"))return "invoice";
    if(value.includes("advance"))return "advance";
    if(value.includes("payment")||value.includes("receipt")||value.includes("refund"))return "final";
  }else{
    if(value.includes("supplier quotation"))return "quote";
    if(value.includes("purchase order"))return "order";
    if(value.includes("receipt")||value.includes("grn"))return "delivery";
    if(value.includes("supplier invoice"))return "invoice";
    if(value.includes("advance"))return "advance";
    if(value.includes("payment"))return "final";
  }
  return "other";
}

function currentKind(documentType:string,current:any,currentNumber:string){
  const upper=currentNumber.toUpperCase();
  if(documentType==="quote")return upper.startsWith("SO-")?"Sales Order":"Sales Quotation";
  if(documentType==="invoice")return upper.startsWith("CN-")?"Sales Credit Note":"Sales Invoice";
  if(documentType==="purchaseOrder")return upper.startsWith("SUPQ-")?"Supplier Quotation":"Purchase Order";
  if(documentType==="supplierBill")return "Supplier Invoice";
  if(documentType==="payment"){
    const supplier=String(current.partyType||"")==="Supplier";
    const against=Boolean(String(current.againstDocumentId||"").trim());
    return supplier?(against?"Purchase Payment":"Supplier Advance / Payment"):(against?"Sales Payment / Receipt":"Customer Advance / Receipt");
  }
  return "Document";
}

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
  const[partyOptions,setPartyOptions]=useState<SearchableSelectOption[]>([]);
  const[partyOptionsLoading,setPartyOptionsLoading]=useState(false);
  const[documentType,setDocumentType]=useState("quote");
  const[documentId,setDocumentId]=useState("");
  const[contextLabel,setContextLabel]=useState("No relationship loaded");
  const[relationshipSide,setRelationshipSide]=useState<Side>("sales");
  const pageSize=20;

  useEffect(()=>{
    setPartyOptionsLoading(true);
    void(async()=>{
      try{
        const response=await fetch(`/api/masters/scoped?scope=${encodeURIComponent(partyType)}`,{cache:"no-store"});
        const body=await response.json();
        if(!response.ok||!body.ok)throw new Error(body.error||"Party list load failed");
        const source=partyType==="customer"?(body.customers||[]):(body.suppliers||[]);
        setPartyOptions(source.map((row:any)=>{
          const id=String(partyType==="customer"?row.customerId:row.supplierId||"");
          const name=String(partyType==="customer"?row.customerName:row.supplierName||id);
          return {value:id,label:`${name} (${id})`,keywords:[name,id]};
        }).filter((row:SearchableSelectOption)=>row.value));
      }catch{setPartyOptions([]);}
      finally{setPartyOptionsLoading(false);}
    })();
  },[partyType]);

  async function loadParty(nextPartyType=partyType,nextPartyId=partyId){
    const cleanId=nextPartyId.trim();
    if(!cleanId){setError("Select a Customer or Supplier first.");return;}
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/erp/party-financial-summary?type=${encodeURIComponent(nextPartyType)}&partyId=${encodeURIComponent(cleanId)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Party document history load failed");
      setRows(Array.isArray(body.documents)?body.documents:[]);
      setRelationshipSide(nextPartyType==="customer"?"sales":"purchase");
      const selected=partyOptions.find(option=>option.value===cleanId);
      setContextLabel(selected?.label||`${nextPartyType==="customer"?"Customer":"Supplier"} · ${cleanId}`);
      setQuery("");setTypeFilter("ALL");setStatusFilter("ALL");setPage(1);
    }catch(reason){setError(reason instanceof Error?reason.message:"Party document history load failed");}
    finally{setLoading(false);}
  }

  async function loadDocument(nextDocumentType=documentType,nextDocumentId=documentId){
    const cleanId=nextDocumentId.trim();
    if(!cleanId){setError("Document number or record ID is required.");return;}
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/erp/transaction-document?type=${encodeURIComponent(nextDocumentType)}&id=${encodeURIComponent(cleanId)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Document relationship load failed");
      const current=body.record||{};
      const resolvedId=String(body.id||cleanId);
      const currentNumber=String(body.number||cleanId);
      const side:Side=nextDocumentType==="purchaseOrder"||nextDocumentType==="supplierBill"||String(current.partyType||"")==="Supplier"?"purchase":"sales";
      const kind=currentKind(nextDocumentType,current,currentNumber);
      const currentDate=String(current.quoteDate||current.invoiceDate||current.poDate||current.billDate||current.paymentDate||current.createdAt||"");
      const mapped:ExplorerRow[]=(body.documentLinks||[]).map((row:any)=>({
        kind:String(row.label||"Linked Document"),
        number:String(row.number||row.id||""),
        status:"",
        amount:null,
        href:String(row.href||"#"),
        direction:row.direction,
        chainId:"document-chain",
      }));
      setRows([{
        kind,
        number:currentNumber,
        status:String(current.status||""),
        amount:Number(current.totalAmount??current.amount??0),
        outstanding:current.outstandingAmount===undefined?undefined:Number(current.outstandingAmount),
        href:`/transactions/${nextDocumentType}/${encodeURIComponent(resolvedId)}`,
        date:currentDate,
        chainId:"document-chain",
      },...mapped]);
      setRelationshipSide(side);
      setContextLabel(`${kind} · ${currentNumber}`);
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

  const filteredRows=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return rows.filter(row=>{
      if(typeFilter!=="ALL"&&row.kind!==typeFilter)return false;
      if(statusFilter!=="ALL"&&row.status!==statusFilter)return false;
      if(!q)return true;
      return [row.kind,row.number,row.status,row.amount,row.outstanding,row.direction,row.date].some(value=>String(value??"").toLowerCase().includes(q));
    });
  },[rows,query,typeFilter,statusFilter]);

  const chains=useMemo(()=>{
    const grouped=new Map<string,ExplorerRow[]>();
    for(const row of filteredRows){
      const key=String(row.chainId||row.number||"unlinked");
      const group=grouped.get(key)||[];
      group.push(row);
      grouped.set(key,group);
    }
    return [...grouped.entries()].map(([chainId,documents])=>{
      const dated=documents.filter(row=>row.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      return {chainId,date:dated[0]?.date||"",documents};
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  },[filteredRows]);

  useEffect(()=>setPage(1),[query,typeFilter,statusFilter,relationshipSide]);
  const pageCount=Math.max(1,Math.ceil(chains.length/pageSize));
  const visibleChains=chains.slice((page-1)*pageSize,page*pageSize);

  function submitParty(event:FormEvent){event.preventDefault();void loadParty();}
  function submitDocument(event:FormEvent){event.preventDefault();void loadDocument();}

  function cellDocuments(documents:ExplorerRow[],stage:string){
    const matches=documents.filter(row=>stageFor(row.kind,relationshipSide)===stage);
    if(!matches.length)return <span className="relationship-empty">—</span>;
    return <div className="relationship-cell-stack">{matches.map((row,index)=><Link className="relationship-doc-chip" href={row.href} key={`${row.href}-${row.number}-${index}`}>
      <strong>{row.number}</strong>
      {row.status&&<span>{row.status}</span>}
      {row.amount!==null&&row.amount!==undefined&&<small>{money(row.amount)}</small>}
    </Link>)}</div>;
  }

  const sales=relationshipSide==="sales";

  return <div className="document-explorer-page">
    <div className="page-head">
      <div>
        <h2>Document Relationship Explorer</h2>
        <p className="small">One row per transaction chain, with each linked document shown in its workflow column.</p>
      </div>
      <Link className="button-link secondary-link" href="/transactions">Back to Transactions</Link>
    </div>

    {error&&<div className="status-banner error">{error}</div>}

    <section className="panel relationship-search-panel">
      <div className="form-title-row">
        <div><h3>Find Relationship</h3><p className="small">Search by Customer / Supplier, or open a chain directly by document number.</p></div>
        <span className="auto-badge">{contextLabel}</span>
      </div>

      <div className="relationship-search-grid">
        <form onSubmit={submitParty} className="relationship-search-card">
          <strong>Customer / Supplier History</strong>
          <select value={partyType} onChange={e=>{setPartyType(e.target.value);setPartyId("");}}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
          </select>
          <SearchableSelect
            value={partyId}
            onChange={setPartyId}
            options={partyOptions}
            placeholder={partyOptionsLoading?"Loading records…":`Search ${partyType} by name or ID…`}
            disabled={partyOptionsLoading}
            emptyLabel={`No matching ${partyType} found`}
          />
          <button type="submit" disabled={loading||!partyId}>{loading?"Loading…":"Open Party History"}</button>
        </form>

        <form onSubmit={submitDocument} className="relationship-search-card">
          <strong>Document Relationship</strong>
          <select value={documentType} onChange={e=>setDocumentType(e.target.value)}>
            {DOCUMENT_TYPES.map(row=><option key={row.value} value={row.value}>{row.label}</option>)}
          </select>
          <input value={documentId} onChange={e=>setDocumentId(e.target.value)} placeholder="Document number or record ID" />
          <button type="submit" disabled={loading||!documentId.trim()}>{loading?"Loading…":"Open Document Chain"}</button>
        </form>
      </div>
    </section>

    <section className="panel relationship-matrix-panel">
      <div className="form-title-row">
        <div>
          <h3>{sales?"Sales":"Purchase"} Relationship Table</h3>
          <p className="small">{sales?"SQ → SO → Delivery → Sales Invoice → Advance → Final Receipt":"Supplier Quote → PO → GRN → Supplier Invoice → Advance → Final Payment"}</p>
        </div>
        <span className="auto-badge">{loading?"LOADING":`${chains.length} CHAIN${chains.length===1?"":"S"}`}</span>
      </div>

      <div className="party-document-toolbar relationship-filter-bar">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search document no., status, amount or date…" />
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

      <div className="relationship-matrix-wrap">
        <table className="relationship-matrix">
          <thead><tr>
            <th className="relationship-date-col">Date</th>
            <th><strong>{sales?"Sales Quotation":"Supplier Quotation"}</strong></th>
            <th><strong>{sales?"Sales Order":"Purchase Order"}</strong></th>
            <th><strong>{sales?"Delivery Note":"Purchase Receipt / GRN"}</strong></th>
            <th><strong>{sales?"Sales Invoice / Credit Note":"Supplier Invoice"}</strong></th>
            <th><strong>{sales?"Customer Advance":"Supplier Advance"}</strong></th>
            <th><strong>{sales?"Final Receipt":"Final Payment"}</strong></th>
          </tr></thead>
          <tbody>
            {visibleChains.length?visibleChains.map(chain=><tr key={chain.chainId}>
              <td className="relationship-date-col"><strong>{shortDate(chain.date)}</strong></td>
              <td>{cellDocuments(chain.documents,"quote")}</td>
              <td>{cellDocuments(chain.documents,"order")}</td>
              <td>{cellDocuments(chain.documents,"delivery")}</td>
              <td>{cellDocuments(chain.documents,"invoice")}</td>
              <td>{cellDocuments(chain.documents,"advance")}</td>
              <td>{cellDocuments(chain.documents,"final")}</td>
            </tr>):<tr><td colSpan={7} className="relationship-empty-row">{loading?"Loading relationship chains…":"No linked relationship loaded."}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="party-document-pagination">
        <span className="small">{chains.length?`Showing chains ${(page-1)*pageSize+1}–${Math.min(page*pageSize,chains.length)} of ${chains.length}`:"No results"}</span>
        <div className="button-row">
          <button className="secondary" type="button" disabled={page<=1} onClick={()=>setPage(v=>Math.max(1,v-1))}>Previous</button>
          <span className="auto-badge">Page {page} / {pageCount}</span>
          <button className="secondary" type="button" disabled={page>=pageCount} onClick={()=>setPage(v=>Math.min(pageCount,v+1))}>Next</button>
        </div>
      </div>
    </section>
  </div>;
}
