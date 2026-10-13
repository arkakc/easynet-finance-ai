"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Preview = { ready: boolean; targetType: string; defaults: { partyId: string; projectId: string; currency: string; totalAmount: number; lines: Array<{ itemId: string; qty: number; rate: number }> }; warnings: string[]; duplicateCandidates: Array<{ id: string; number: string; status: string }> };
export default function TransactionAutomationPreview({ type, id }: { type: string; id: string }) {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!["quote", "purchaseOrder"].includes(type)) return;
    const controller = new AbortController();
    fetch(`/api/erp/transaction-automation-preview?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || "Preview unavailable"); return body; })
      .then(body => { if (!controller.signal.aborted) setData(body); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Preview unavailable"); });
    return () => controller.abort();
  }, [type, id]);
  if (!["quote", "purchaseOrder"].includes(type)) return null;
  return <section className="panel no-print" aria-label="Intelligent transaction automation preview" style={{ marginTop: 16 }}>
    <h2>Automation Readiness & Prefill</h2>
    <p className="small">Read-only proposed fields from the saved source document. Existing conversion controls still validate and save the new document.</p>
    {error && <p role="alert" className="small">{error}</p>}
    {!data && !error && <p className="small">Checking source and existing documents…</p>}
    {data && <>
      <p><strong>{data.ready ? "Source prefill available" : "Source needs review"}</strong> · Target: {data.targetType}</p>
      <div className="document-meta">
        <div><span>Party ID</span><strong>{data.defaults.partyId || "Missing"}</strong></div>
        <div><span>Project ID</span><strong>{data.defaults.projectId || "None"}</strong></div>
        <div><span>Currency</span><strong>{data.defaults.currency}</strong></div>
        <div><span>Source Total</span><strong>{data.defaults.totalAmount.toFixed(2)}</strong></div>
        <div><span>Source Lines</span><strong>{data.defaults.lines.length}</strong></div>
      </div>
      {data.warnings.map((warning, index) => <p key={index} className="small" role="status">{warning}</p>)}
      {data.duplicateCandidates.length > 0 && <div>
        <strong>Existing related documents</strong>
        <ul>{data.duplicateCandidates.map((candidate, index) => {
          const detailType = type === "quote" ? "quote" : "supplierBill";
          return <li key={index}>{candidate.id ? <Link href={`/transactions/${detailType}/${encodeURIComponent(candidate.id)}`}>{candidate.number || candidate.id}</Link> : candidate.number || "Unknown reference"} · {candidate.status || "Unknown"}</li>;
        })}</ul>
      </div>}
      <a href="#document-actions" className="button-link secondary-link">Review controlled conversion actions →</a>
    </>}
  </section>;
}
