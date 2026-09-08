"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PrintButton from "@/app/components/print-button";

const n=(value:unknown)=>{const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;};
const money=(value:unknown)=>`K${n(value).toFixed(2)}`;

export default function SourceDocumentClient({documentId}:{documentId:string}){
  const[doc,setDoc]=useState<any|null>(null);
  const[lines,setLines]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");

  useEffect(()=>{
    const controller=new AbortController();
    const frame=window.requestAnimationFrame(()=>{void(async()=>{
      try{
        const response=await fetch(`/api/ui/documents?documentId=${encodeURIComponent(documentId)}`,{cache:"no-store",signal:controller.signal});
        const body=await response.json();
        if(!response.ok||!body.ok)throw new Error(body.error||"Document load failed");
        setDoc(body.document||null);setLines(body.lines||[]);
      }catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:"Document load failed");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();});
    return()=>{controller.abort();window.cancelAnimationFrame(frame);};
  },[documentId]);

  return <div className="document-page">
    <div className="document-toolbar no-print"><Link href="/documents">← Source Documents</Link><div className="row-actions">{doc?.driveUrl&&<a className="button-link secondary-link" href={doc.driveUrl} target="_blank" rel="noreferrer">Open Original</a>}<PrintButton/></div></div>
    {error&&<section className="panel warning-panel"><strong>Document unavailable.</strong> {error}</section>}
    <section className="document-sheet">
      <header className="document-header"><div><div className="eyebrow">SOURCE DOCUMENT / AI EVIDENCE</div><h1>{doc?.documentType||"Source Document"}</h1><div className="document-number">{doc?.documentNumber||documentId}</div></div><div className={`status-pill status-${String(doc?.status||"loading").toLowerCase()}`}>{loading?"LOADING":doc?.status||"REVIEW"}</div></header>
      {loading?<section className="panel"><strong>Loading live document values…</strong></section>:doc?<>
        <div className="document-meta"><div><span>File</span><strong>{doc.sourceFileName||"—"}</strong></div><div><span>Party</span><strong>{doc.partyId||doc.partyType||"Unresolved"}</strong></div><div><span>Project</span><strong>{doc.projectId||"—"}</strong></div><div><span>Date</span><strong>{doc.documentDate||"—"}</strong></div><div><span>Net</span><strong>{money(doc.netAmount)}</strong></div><div><span>GST</span><strong>{money(doc.gstAmount)}</strong></div><div><span>Total</span><strong>{money(doc.totalAmount)}</strong></div><div><span>Currency</span><strong>{doc.currency||"PGK"}</strong></div><div><span>AI Confidence</span><strong>{(n(doc.aiConfidence)*100).toFixed(1)}%</strong></div></div>
        {lines.length>0&&<div className="document-lines"><table className="data-table"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead><tbody>{lines.map((line:any)=><tr key={line.documentLineId}><td>{line.lineNo}</td><td>{line.description}</td><td>{line.qty}</td><td>{line.uom||"—"}</td><td>{money(line.rate)}</td><td>{money(line.netAmount)}</td><td>{money(line.gstAmount)}</td><td><strong>{money(line.totalAmount)}</strong></td></tr>)}</tbody></table></div>}
        <div className="evidence-block"><span>SHA-256 Evidence Fingerprint</span><code>{doc.sha256||"—"}</code></div><div className="document-footer"><span>Human review required before accounting action.</span><span>Record ID: {doc.documentId}</span></div>
      </>:!error?<p>No document found.</p>:null}
    </section>
  </div>;
}
