"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Party={partyCode:string;partyName:string;total:number;overdue:number};
type Row={id:string;code:string;partyName:string;dueDate:string|null;bucket:string;outstanding:number};
type Side={total:number;parties:Party[];rows:Row[]};
type Payload={ok:boolean;error?:string;currency:string;asOf:string;ageing:{receivables:Side;payables:Side};forecast:{openingCash:number;ledgerCashBalanced:boolean;method:string;periods:{day:number;expectedReceipts:number;expectedPayments:number;projectedCash:number}[]};control:{receivables:{difference:number;matched:boolean};payables:{difference:number;matched:boolean}}};
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export default function ForwardFinancePage(){
 const [asOf,setAsOf]=useState(today);
 const [horizon,setHorizon]=useState("90");
 const [data,setData]=useState<Payload|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError("");
  fetch("/api/reports/forward-finance?"+new URLSearchParams({asOf,horizon}),{signal:controller.signal,cache:"no-store"}).then(async response=>{
    const p=await response.json() as Payload;if(!response.ok||!p.ok)throw new Error(p.error||"Report failed");return p;
  }).then(setData).catch(e=>{if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:"Report failed")}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return ()=>controller.abort();
 },[asOf,horizon]);
 const money=(n:number)=>new Intl.NumberFormat("en-PG",{style:"currency",currency:data?.currency||"PGK"}).format(n);
 return <><div className="page-head"><div><h2>AR/AP Ageing & Cash Outlook</h2><p className="small">Posted-document ageing and a due-date cash scenario, as of a selected date.</p></div><Link href="/reports" className="button-link secondary-link">Financial Statements</Link></div>
  <section className="panel form-grid"><label>As-of date<input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></label><label>Outlook days<select value={horizon} onChange={e=>setHorizon(e.target.value)}><option value="30">30</option><option value="60">60</option><option value="90">90</option><option value="180">180</option><option value="365">365</option></select></label></section>
  {loading&&<p>Loading posted financial data…</p>}{error&&<section className="panel warning-panel" role="alert">{error}</section>}
  {data&&!loading&&<><section className="panel"><h3>Due-date Cash Scenario</h3><p className="small">{data.forecast.method}</p>{!data.forecast.ledgerCashBalanced&&<p className="warning-panel">Cash GL reconciliation requires review.</p>}
  <p>Starting cash: <strong>{money(data.forecast.openingCash)}</strong></p><div className="table-wrap"><table className="data-table"><thead><tr><th>Through day</th><th>Expected AR receipts</th><th>Expected AP payments</th><th>Indicative closing cash</th></tr></thead><tbody>{data.forecast.periods.map(x=><tr key={x.day}><td>{x.day}</td><td>{money(x.expectedReceipts)}</td><td>{money(x.expectedPayments)}</td><td>{money(x.projectedCash)}</td></tr>)}</tbody></table></div></section>
  {(["receivables","payables"] as const).map(kind=>{const side=data.ageing[kind];const isAR=kind==="receivables";return <section className="panel" key={kind}><h3>{isAR?"Customer Receivables":"Supplier Payables"} Ageing</h3>
  <p>Outstanding: <strong>{money(side.total)}</strong> · GL reconciliation difference: <strong>{money(data.control[kind].difference)}</strong> {data.control[kind].matched?"(matched)":"(review required)"}</p>
  <h4>Party Summary</h4><div className="table-wrap"><table className="data-table"><thead><tr><th>{isAR?"Customer":"Supplier"}</th><th>Total</th><th>Overdue</th></tr></thead><tbody>{side.parties.map(x=><tr key={x.partyCode}><td>{x.partyName} ({x.partyCode})</td><td>{money(x.total)}</td><td>{money(x.overdue)}</td></tr>)}{!side.parties.length&&<tr><td colSpan={3}>No open posted balances.</td></tr>}</tbody></table></div>
  <h4>Document Drill-down</h4><div className="table-wrap"><table className="data-table"><thead><tr><th>Document</th><th>Party</th><th>Due date</th><th>Bucket</th><th>Outstanding</th></tr></thead><tbody>{side.rows.map(x=><tr key={x.id}><td><Link href={`/transactions/${isAR?"invoice":"supplierBill"}/${encodeURIComponent(x.id)}`}>{x.code}</Link></td><td>{x.partyName}</td><td>{x.dueDate||"—"}</td><td>{x.bucket}</td><td>{money(x.outstanding)}</td></tr>)}</tbody></table></div></section>})}</>}
 </>;
}
