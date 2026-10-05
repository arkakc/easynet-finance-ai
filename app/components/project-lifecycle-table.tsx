"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProjectLifecycleActions from "@/app/components/project-lifecycle-actions";

type Row={
  projectId:string;
  projectName:string;
  customerId:string;
  status:string;
  contractTotal:number;
  revenue:number;
  cost:number;
  grossProfit:number;
  margin:number;
  commitments:number;
  openCommitment:number;
  usageCount:number;
};

const money=(value:number)=>new Intl.NumberFormat("en-PG",{style:"currency",currency:"PGK",minimumFractionDigits:2}).format(Number(value||0));
const inactive=(status:string)=>["ON_HOLD","CANCELLED"].includes(String(status||"").toUpperCase());

export default function ProjectLifecycleTable({rows,error}:{rows:Row[];error?:string}){
  const router=useRouter();
  const[selected,setSelected]=useState<string[]>([]);
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");

  const chosen=rows.filter(row=>selected.includes(row.projectId));
  const deletable=chosen.filter(row=>Number(row.usageCount||0)===0);
  const disableable=chosen.filter(row=>Number(row.usageCount||0)>0&&!inactive(row.status));
  const activatable=chosen.filter(row=>inactive(row.status));

  async function runOne(projectId:string,mode:"delete"|"disable"|"activate"){
    const response=await fetch("/api/erp/actions",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({target:"masters",body:{type:"project",mode,record:{projectId}}}),
    });
    const body=await response.json();
    if(!response.ok||!body.ok)throw new Error(body.error||`Project ${mode} failed`);
  }

  async function runBulk(mode:"delete"|"disable"|"activate",targets:Row[]){
    if(busy||targets.length===0)return;
    const label=mode==="delete"?"Delete":mode==="disable"?"Disable":"Activate";
    const note=mode==="delete"
      ?"Only selected projects with no transaction/history will be deleted."
      :mode==="disable"
        ?"Only selected active projects with transaction/history will be disabled and retained for audit."
        :"Only selected inactive projects will be activated.";
    if(!window.confirm(`${label} ${targets.length} selected project(s)?\n\n${note}`))return;
    setBusy(mode);setMessage("");
    let success=0,failed=0;
    for(const row of targets){
      try{await runOne(row.projectId,mode);success+=1;}catch{failed+=1;}
    }
    setMessage(`${label} complete: ${success} succeeded, ${failed} failed.`);
    setSelected([]);
    setBusy("");
    router.refresh();
  }

  return <section className="panel table-wrap">
    <div className="button-row" style={{justifyContent:"space-between",marginBottom:14}}>
      <label style={{display:"flex",alignItems:"center",gap:8}}>
        <input
          type="checkbox"
          checked={rows.length>0&&selected.length===rows.length}
          onChange={event=>setSelected(event.target.checked?rows.map(row=>row.projectId):[])}
        />
        Select all
      </label>
      <div className="button-row" style={{justifyContent:"flex-end"}}>
        <button type="button" className="danger-button" disabled={Boolean(busy)||deletable.length===0} onClick={()=>void runBulk("delete",deletable)}>
          {busy==="delete"?"Deleting…":`Delete Selected (${deletable.length})`}
        </button>
        <button type="button" className="secondary" disabled={Boolean(busy)||disableable.length===0} onClick={()=>void runBulk("disable",disableable)}>
          {busy==="disable"?"Disabling…":`Disable Selected (${disableable.length})`}
        </button>
        <button type="button" className="secondary" disabled={Boolean(busy)||activatable.length===0} onClick={()=>void runBulk("activate",activatable)}>
          {busy==="activate"?"Activating…":`Activate Selected (${activatable.length})`}
        </button>
      </div>
    </div>
    {message&&<div className="status-banner success">{message}</div>}
    <table className="data-table">
      <thead>
        <tr>
          <th>Select</th><th>Project</th><th>Customer</th><th>Status</th><th>Contract</th><th>Revenue</th><th>Posted Cost</th><th>Gross Profit</th><th>Margin</th><th>PO Commitments</th><th>Open Commitment</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row=><tr key={row.projectId}>
          <td><input type="checkbox" checked={selected.includes(row.projectId)} onChange={event=>setSelected(current=>event.target.checked?[...new Set([...current,row.projectId])]:current.filter(id=>id!==row.projectId))}/></td>
          <td><strong>{row.projectName}</strong><br/><span className="small">{row.projectId}</span></td>
          <td>{row.customerId||"—"}</td>
          <td><span className="auto-badge">{row.status}</span></td>
          <td>{money(row.contractTotal)}</td>
          <td>{money(row.revenue)}</td>
          <td>{money(row.cost)}</td>
          <td>{money(row.grossProfit)}</td>
          <td>{Number(row.margin||0).toFixed(1)}%</td>
          <td>{money(row.commitments)}</td>
          <td>{money(row.openCommitment)}</td>
          <td><ProjectLifecycleActions projectId={row.projectId} projectName={row.projectName} status={row.status} usageCount={Number(row.usageCount||0)}/></td>
        </tr>)}
        {!rows.length&&!error&&<tr><td colSpan={12}>No projects found.</td></tr>}
      </tbody>
    </table>
  </section>;
}
