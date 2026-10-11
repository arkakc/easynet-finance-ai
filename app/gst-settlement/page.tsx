"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Bank={id:string;name:string;code:string;ledger?:string};
type Preview={balances:{outputDue:number;inputCredit:number;net:number};banks:Bank[]};
type RecordRow={id:string;code:string;period:string;paymentDate:string;bankAccountId:string;paymentReference:string;status:string;outputGst:number;inputGst:number;netPayable:number;journalId?:string|null;rejectionReason?:string|null;cancelReason?:string|null;createdBy:string};
const money=(n:number)=>"K"+Number(n||0).toFixed(2);
export default function GstSettlementPage(){
 const [records,setRecords]=useState<RecordRow[]>([]);
 const [id,setId]=useState("");
 const [date,setDate]=useState("2026-10-11");
 const [period,setPeriod]=useState("2026-10");
 const [bankId,setBankId]=useState("");
 const [ref,setRef]=useState("");
 const [preview,setPreview]=useState<Preview|null>(null);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [reason,setReason]=useState("");
 const [reversalDate,setReversalDate]=useState("");
 const [eligibilityConfirmed,setEligibilityConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<RecordRow|null>(null);
 async function reload(){
  const res=await fetch("/api/gst/settlement",{cache:"no-store"});
  const data=await res.json();
  if(!res.ok||!data.ok)throw new Error(data.error||"Cannot load GST documents");
  setRecords(data.records||[]);
  const requested=id||new URLSearchParams(window.location.search).get("document")||"";
  if(requested){const row=(data.records||[]).find((r:RecordRow)=>r.id===requested);if(row)choose(row);}
 }
 useEffect(()=>{void reload().catch(e=>setError(String(e)));},[]);
 function choose(row:RecordRow){
  setId(row.id);setSelected(row);setEligibilityConfirmed(false);setReversalDate(row.paymentDate);setDate(row.paymentDate);setPeriod(row.period);setBankId(row.bankAccountId);setRef(row.paymentReference);setPreview(null);setError("");setMessage("");
 }
 function clear(){
  setId("");setSelected(null);setEligibilityConfirmed(false);setPreview(null);setRef("");setBankId("");setReason("");setError("");setMessage("");
 }
 async function calculate(){
  setBusy(true);setError("");setMessage("");setPreview(null);
  try{
   const res=await fetch("/api/gst/settlement?date="+encodeURIComponent(date)+"&period="+encodeURIComponent(period),{cache:"no-store"});
   const body=await res.json();if(!res.ok||!body.ok)throw new Error(body.error||"Calculation failed");
   setPreview(body);if(!bankId)setBankId(body.banks[0]?.id||"");
  }catch(e){setError(e instanceof Error?e.message:"Calculation failed");}
  finally{setBusy(false);}
 }
 async function action(act:"SAVE"|"SUBMIT"|"APPROVE"|"REJECT"|"CANCEL"|"REVERSE"){
  setBusy(true);setError("");setMessage("");
  try{
   const res=await fetch("/api/gst/settlement",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:act,id:id||undefined,paymentDate:date,period,bankAccountId:bankId,paymentReference:ref,reason,reversalDate,eligibilityConfirmed})});
   const body=await res.json();if(!res.ok||!body.ok)throw new Error(body.error||"Action failed");
   setMessage(body.record.code+" → "+body.record.status+(body.record.journalId?" · Linked journal "+body.record.journalId:""));
   const list=await fetch("/api/gst/settlement",{cache:"no-store"}).then(r=>r.json());
   if(list.ok){setRecords(list.records);const row=list.records.find((v:RecordRow)=>v.id===body.record.id);if(row)choose(row);}
   setReason("");
  }catch(e){setError(e instanceof Error?e.message:"Action failed");}
  finally{setBusy(false);}
 }
 const editable=!id||selected?.status==="DRAFT"||selected?.status==="REJECTED";
 return <div>
  <div className="page-head"><div><h2>GST Settlement &amp; Payment</h2><p className="small">Dedicated DocType: Save Draft → Submit → Checker Approve → Auto Post GL Journal.</p></div><button type="button" onClick={clear}>New GST Settlement</button></div>
  <section className="panel">
   <h3>GST Settlement Documents</h3>
   <div style={{overflowX:"auto"}}><table><thead><tr><th>Document No</th><th>Period</th><th>Date</th><th>Status</th><th>Net Payable</th><th>Linked Journal</th><th>Open</th></tr></thead><tbody>
    {records.map(row=><tr key={row.id}><td>{row.code}</td><td>{row.period}</td><td>{row.paymentDate}</td><td>{row.status}</td><td>{money(row.netPayable)}</td><td>{row.journalId?<Link href={"/journals/"+row.journalId}>View Journal</Link>:"Not posted"}</td><td><button type="button" onClick={()=>choose(row)}>Open</button></td></tr>)}
   </tbody></table></div>
  </section>
  <section className="panel form-grid">
   <div className="form-wide"><h3>{selected?selected.code:"New GST Settlement Draft"} {selected?"· "+selected.status:""}</h3></div>
   <label>Payment Date<input type="date" value={date} disabled={!editable} onChange={e=>{setDate(e.target.value);setPreview(null);}} /></label>
   <label>IRC Tax Period<input type="month" value={period} disabled={!editable} onChange={e=>setPeriod(e.target.value)}/></label>
   <label>Bank Account{preview&&editable?<select value={bankId} onChange={e=>setBankId(e.target.value)}><option value="">Choose bank</option>{preview.banks.map(bank=><option key={bank.id} value={bank.id}>{bank.name} ({bank.code}) GL {bank.ledger}</option>)}</select>:<input value={bankId} disabled={!editable} onChange={e=>setBankId(e.target.value)} placeholder="Calculate first to choose bank"/>}</label>
   <label>IRC / Payment Reference<input value={ref} disabled={!editable} onChange={e=>setRef(e.target.value)} placeholder="Tax return / bank reference"/></label>
   {editable&&<div className="form-wide"><button type="button" disabled={busy} onClick={()=>void calculate()}>Calculate GST Automatically</button></div>}
   {preview&&<div className="form-wide"><h3>System GST Calculation</h3><p>Output GST {money(preview.balances.outputDue)} | Input GST {money(preview.balances.inputCredit)} | <strong>Net Payable {money(preview.balances.net)}</strong></p></div>}
   {selected&&<div className="form-wide"><strong>Saved GST Snapshot</strong><p>Output {money(selected.outputGst)}, Input {money(selected.inputGst)}, Net {money(selected.netPayable)}</p>{selected.journalId&&<Link href={"/journals/"+selected.journalId}>Open Linked Posted Journal</Link>}</div>}
   {selected?.rejectionReason&&<p className="form-wide">Reject reason: {selected.rejectionReason}</p>}
   {selected?.cancelReason&&<p className="form-wide">Cancel reason: {selected.cancelReason}</p>}
   {selected&&editable&&<div className="form-wide"><label><input type="checkbox" checked={eligibilityConfirmed} onChange={e=>setEligibilityConfirmed(e.target.checked)}/> I have reviewed applicable IRC GST period, tax evidence and input-tax-credit eligibility.</label></div>}
   {editable&&<div className="form-wide button-row"><button type="button" disabled={busy||!bankId||!ref.trim()||!date||!period} onClick={()=>void action("SAVE")}>{id?"Save Changes":"Save Draft"}</button>{id&&<button type="button" disabled={busy} disabled={busy||!eligibilityConfirmed} onClick={()=>void action("SUBMIT")}>Submit for Approval</button>}</div>}
   {selected?.status==="PENDING"&&<div className="form-wide button-row"><button type="button" disabled={busy} onClick={()=>void action("APPROVE")}>Approve &amp; Auto Post Journal</button></div>}
   {selected?.status==="POSTED"&&<div className="form-wide"><h3>Controlled Cancellation (Reversal)</h3><p>Checker permission required. Creates a separate posted reversal journal; the original remains immutable.</p><label>Reversal date<input type="date" value={reversalDate} onChange={e=>setReversalDate(e.target.value)} /></label><label>Cancellation / Reversal reason<input value={reason} onChange={e=>setReason(e.target.value)} /></label><button type="button" disabled={busy||!reversalDate||!reason.trim()} onClick={()=>void action("REVERSE")}>Reverse Posted Settlement</button></div>}
   {selected&&["DRAFT","REJECTED","PENDING"].includes(selected.status)&&<div className="form-wide"><label>Rejection / Cancellation Reason<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required for reject or cancel"/></label><div className="button-row">{selected.status==="PENDING"&&<button type="button" disabled={busy||!reason.trim()} onClick={()=>void action("REJECT")}>Reject</button>}<button type="button" disabled={busy||!reason.trim()} onClick={()=>void action("CANCEL")}>Cancel Document</button></div></div>}
   {message&&<p role="status" className="form-wide">{message}</p>}{error&&<p role="alert" className="form-wide">{error}</p>}
   <p className="form-wide small">Only checker approval posts the journal. This GL-based calculator is for the selected month only; it excludes GST settlement postings, but is not an IRC-certified statutory return. Validate eligible input GST, tax codes and documentary evidence. Confirm eligibility and payment evidence; posted cancellation requires an authorised reversal.</p>
  </section>
 </div>;
}
