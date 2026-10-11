"use client";
import { useState } from "react";
import Link from "next/link";

type Preview = { balances: { outputDue: number; inputCredit: number; net: number }; banks: { id: string; name: string; code: string; ledger?: string }[] };
const money=(n:number)=>"K"+n.toFixed(2);
export default function GstSettlementPage() {
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [period,setPeriod]=useState(new Date().toISOString().slice(0,7));
  const [reference,setReference]=useState("");
  const [bankId,setBankId]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState("");
  const [result,setResult]=useState("");
  const [busy,setBusy]=useState(false);
  async function load() {
    setBusy(true);setError("");setResult("");setPreview(null);
    try {
      const res=await fetch("/api/gst/settlement?date="+encodeURIComponent(date),{cache:"no-store"});
      const body=await res.json();
      if(!res.ok||!body.ok)throw new Error(body.error||"GST preview failed");
      setPreview(body);setBankId(body.banks[0]?.id||"");
    } catch(e){setError(e instanceof Error?e.message:"GST preview failed");}
    finally{setBusy(false);}
  }
  async function submit() {
    if(!preview||!bankId||!reference.trim())return;
    setBusy(true);setError("");setResult("");
    try{
      const res=await fetch("/api/gst/settlement",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentDate:date,period,bankAccountId:bankId,paymentReference:reference})});
      const body=await res.json();
      if(!res.ok||!body.ok)throw new Error(body.error||"GST settlement submission failed");
      setResult("Submitted for checker approval: "+body.result.journalId+". The bank and GST GL have NOT changed yet.");
      setPreview(null);
    }catch(e){setError(e instanceof Error?e.message:"GST settlement submission failed");}
    finally{setBusy(false);}
  }
  return <div>
    <div className="page-head"><div><h2>GST Settlement & Payment</h2><p className="small">Guided tax settlement: system calculates the GL journal. Checker approval is required before posting.</p></div><Link className="secondary-btn" href="/journals">Journal Approvals</Link></div>
    <section className="panel form-grid">
      <label>Payment date<input type="date" value={date} onChange={e=>{setDate(e.target.value);setPreview(null);}} /></label>
      <label>IRC reporting period (reference)<input type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></label>
      <div className="form-wide button-row"><button type="button" onClick={()=>void load()} disabled={busy||!date}>{busy?"Loading…":"Calculate GST Automatically"}</button></div>
      {preview&&<>
        <div className="form-wide conversion-box"><strong>Calculated from POSTED GST control GL balances through payment date</strong>
          <p>Output GST: {money(preview.balances.outputDue)} · Input GST: {money(preview.balances.inputCredit)} · <strong>Net payable: {money(preview.balances.net)}</strong></p>
          <p className="small">Period is a reference label; this preview is cumulative through the payment date, not an official IRC return. Verify filing period and input eligibility before approval.</p>
        </div>
        <label>Pay from linked Bank Account<select value={bankId} onChange={e=>setBankId(e.target.value)}><option value="">Select Bank</option>{preview.banks.map(b=><option key={b.id} value={b.id}>{b.name} ({b.code}) / GL {b.ledger}</option>)}</select></label>
        <label>IRC payment / banking reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Enter official reference" /></label>
        <div className="form-wide button-row"><button type="button" disabled={busy||!bankId||reference.trim().length<3||preview.balances.net<=0} onClick={()=>void submit()}>Submit GST Payment for Approval</button></div>
      </>}
      {error&&<div className="form-wide warning-panel" role="alert"><strong>Action required</strong><p>{error}</p></div>}
      {result&&<div className="form-wide conversion-box" role="status">{result}</div>}
    </section>
  </div>;
}
