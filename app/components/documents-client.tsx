"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DocumentRow = {
  documentId:string; sourceFileName:string; driveUrl:string; documentType:string; documentNumber:string;
  partyType:string; partyId:string; projectId:string; documentDate:string; netAmount:number|string;
  gstAmount:number|string; totalAmount:number|string; aiConfidence:number|string; status:string; createdAt:string;
};
type Line = { documentLineId:string; documentId:string; lineNo:number|string; description:string; qty:number|string; uom:string; rate:number|string; netAmount:number|string; gstAmount:number|string; totalAmount:number|string };

const n=(value:unknown)=>{const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;};
const money=(value:unknown)=>`K${n(value).toFixed(2)}`;

export default function DocumentsClient(){
  const[documents,setDocuments]=useState<DocumentRow[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[linesByDocument,setLinesByDocument]=useState<Record<string,Line[]>>({});
  const[loadingLines,setLoadingLines]=useState("");

  useEffect(()=>{
    const controller=new AbortController();
    const frame=window.requestAnimationFrame(()=>{void(async()=>{
      try{
        const response=await fetch("/api/ui/documents",{cache:"no-store",signal:controller.signal});
        const body=await response.json();
        if(!response.ok||!body.ok)throw new Error(body.error||"Document register load failed");
        const rows=(body.documents||[]) as DocumentRow[];
        setDocuments([...rows].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))));
      }catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:"Document register load failed");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();});
    return()=>{controller.abort();window.cancelAnimationFrame(frame);};
  },[]);

  async function toggleLines(documentId:string){
    if(linesByDocument[documentId]){setLinesByDocument(current=>{const next={...current};delete next[documentId];return next;});return;}
    setLoadingLines(documentId);
    try{
      const response=await fetch(`/api/ui/documents?documentId=${encodeURIComponent(documentId)}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Document lines load failed");
      setLinesByDocument(current=>({...current,[documentId]:body.lines||[]}));
    }catch(err){setError(err instanceof Error?err.message:"Document lines load failed");}
    finally{setLoadingLines("");}
  }

  return <>
    <h2>Source Document Register</h2>
    <p className="small">Register UI loads first. Document headers load after first paint; extracted line details are fetched only when you open them.</p>
    {error&&<section className="panel"><strong>Backend warning:</strong> {error}</section>}
    {loading&&<section className="panel"><strong>Loading live document register…</strong></section>}

    {documents.map(doc=>{
      const lines=linesByDocument[doc.documentId];
      return <section className="panel" key={doc.documentId}>
        <div className="journal-head"><div><strong>{doc.documentType} · {doc.documentNumber||"No document number"}</strong><br/><span className="small">{doc.sourceFileName} · {doc.documentId}</span></div><div><strong>{doc.status}</strong><br/><span className="small">AI confidence {(n(doc.aiConfidence)*100).toFixed(1)}%</span></div></div>
        <div className="doc-summary"><span>Party: <strong>{doc.partyId||doc.partyType||"Unresolved"}</strong></span><span>Project: <strong>{doc.projectId||"—"}</strong></span><span>Date: <strong>{doc.documentDate||"—"}</strong></span><span>Net: <strong>{money(doc.netAmount)}</strong></span><span>GST: <strong>{money(doc.gstAmount)}</strong></span><span>Total: <strong>{money(doc.totalAmount)}</strong></span></div>
        <div className="button-row"><Link prefetch={false} className="button-link" href={`/documents/${doc.documentId}`}>View / Print Preview</Link>{doc.driveUrl?<a className="button-link secondary-link" href={doc.driveUrl} target="_blank" rel="noreferrer">Open Original Source</a>:null}<button type="button" className="secondary" disabled={loadingLines===doc.documentId} onClick={()=>void toggleLines(doc.documentId)}>{loadingLines===doc.documentId?"Loading Lines…":lines?"Hide Extracted Lines":"Show Extracted Lines"}</button></div>
        {!doc.driveUrl&&<p className="warning-text">Source binary not yet retained in Drive for this record.</p>}
        {lines&&<div className="table-wrap"><table className="data-table"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead><tbody>{lines.map(line=><tr key={line.documentLineId}><td>{line.lineNo}</td><td>{line.description}</td><td>{line.qty}</td><td>{line.uom||"—"}</td><td>{money(line.rate)}</td><td>{money(line.netAmount)}</td><td>{money(line.gstAmount)}</td><td>{money(line.totalAmount)}</td></tr>)}{!lines.length&&<tr><td colSpan={8}>No extracted lines found.</td></tr>}</tbody></table></div>}
      </section>;
    })}
    {!loading&&!documents.length&&!error&&<section className="panel">No source documents loaded yet.</section>}
  </>;
}
