"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Setting={key:string;value:string;notes:string;updatedAt?:string};
const GST_STATUSES=["UNVERIFIED","VERIFIED","NOT_REGISTERED"] as const;

export default function SettingsPage(){
  const[settings,setSettings]=useState<Setting[]>([]);
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[selectedKey,setSelectedKey]=useState("gst_status");
  const[settingValue,setSettingValue]=useState("");
  const[notes,setNotes]=useState("");

  async function load(){
    setLoading(true);
    try{
      const r=await fetch("/api/settings",{cache:"no-store"});
      const b=await r.json();
      if(!r.ok||!b.ok)throw new Error(b.error||"Settings load failed");
      setSettings(b.settings||[]);
    }catch(e){setMessage(e instanceof Error?e.message:"Settings load failed");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  const current=useMemo(()=>settings.find(row=>row.key===selectedKey)||null,[settings,selectedKey]);
  useEffect(()=>{
    setSettingValue(String(current?.value||""));
    setNotes(String(current?.notes||""));
  },[current?.key,current?.value,current?.notes]);

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(saving)return;
    setSaving(true);
    setMessage(`Saving ${selectedKey}…`);
    try{
      const r=await fetch("/api/erp/actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:"settings",body:{setting:{key:selectedKey,value:settingValue,notes}}})});
      const b=await r.json();
      if(!r.ok||!b.ok)throw new Error(b.error||"Save failed");
      setMessage(`${b.row.key} ${b.action}.`);
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:"Save failed");}
    finally{setSaving(false);}
  }

  const value=(key:string)=>settings.find(row=>row.key===key)?.value||"";
  const gstStatus=String(value("gst_status")||"UNVERIFIED").toUpperCase();

  return <>
    <h2>Finance Settings</h2>
    <p className="small">Controlled configuration. Only users with Settings permission can read or update these values.</p>

    <div className="grid">
      <div className="card"><div className="label">Company</div><div className="value small-value">{loading?"Loading…":value("company_name")||"—"}</div></div>
      <div className="card"><div className="label">Base Currency</div><div className="value">{loading?"—":value("base_currency")||"—"}</div></div>
      <div className="card"><div className="label">GST Control Status</div><div className="value small-value">{loading?"Loading…":gstStatus}</div></div>
      <div className="card"><div className="label">GST Number</div><div className="value small-value">{loading?"—":value("gst_number")||"—"}</div></div>
    </div>

    {gstStatus==="VERIFIED"&&<section className="panel"><strong>GST control flag is VERIFIED.</strong><p className="small">This ERP flag is accepted only after a GST number, an evidence/reference note and a retained GST_REGISTRATION source file exist. It is still a system control state, not a substitute for tax-filing verification.</p></section>}
    {message&&<section className="panel status-banner"><strong>Status:</strong> {message}</section>}

    <form className="panel form-grid" onSubmit={save}>
      <div className="form-title-row form-wide"><div><h3>Update Setting</h3><p className="small">Select a setting, review its current value and save the replacement. Changes remain auditable through the backend update trail.</p></div><span className="auto-badge">{saving?"SAVING…":"CONTROLLED"}</span></div>
      <label>Setting<select value={selectedKey} onChange={(e)=>setSelectedKey(e.target.value)} required disabled={saving||loading}><option value="company_name">Company Name</option><option value="base_currency">Base Currency</option><option value="financial_year_start_month">Financial Year Start Month</option><option value="gst_status">GST Status</option><option value="gst_number">GST Number</option><option value="company_bank_name">Company Bank Name</option><option value="company_bank_account">Company Bank Account</option><option value="company_bank_bsb">Company Bank BSB</option></select></label>
      <label>Value{selectedKey==="gst_status"?<select value={settingValue} onChange={(e)=>setSettingValue(e.target.value)} required disabled={saving||loading}><option value="">Select GST status</option>{GST_STATUSES.map(status=><option key={status} value={status}>{status}</option>)}</select>:<input value={settingValue} onChange={(e)=>setSettingValue(e.target.value)} required disabled={saving||loading}/>}<span className="small">Current: {current?.value||"Not configured"}</span></label>
      <label className="form-wide">Evidence / Notes<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={3} disabled={saving||loading} placeholder={selectedKey==="gst_status"?"Required evidence/reference note when changing GST status to VERIFIED.":"Reason, reference or supporting note"}/></label>
      {selectedKey==="gst_status"&&settingValue==="VERIFIED"&&<div className="form-wide status-banner">VERIFIED requires a recorded GST number plus a retained source document with type GST_REGISTRATION. Save will be blocked if the evidence is missing.</div>}
      <div className="form-wide"><button type="submit" disabled={saving||loading||!settingValue.trim()}>{saving?"Saving…":"Save Setting"}</button></div>
    </form>

    <section className="panel table-wrap">
      <div className="form-title-row"><h3>Current Settings</h3><span className="auto-badge">{loading?"Loading…":`${settings.length} Settings`}</span></div>
      <table className="data-table"><thead><tr><th>Key</th><th>Value</th><th>Notes</th><th>Updated</th></tr></thead><tbody>{settings.map((row)=><tr key={row.key}><td>{row.key}</td><td>{row.value}</td><td>{row.notes||"—"}</td><td>{row.updatedAt||"—"}</td></tr>)}{!loading&&!settings.length&&<tr><td colSpan={4}>No finance settings found.</td></tr>}</tbody></table>
    </section>
  </>;
}
