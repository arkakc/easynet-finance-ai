"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props={
  projectId:string;
  projectName:string;
  status:string;
  usageCount:number;
};

export default function ProjectLifecycleActions({projectId,projectName,status,usageCount}:Props){
  const router=useRouter();
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");

  async function run(mode:"delete"|"disable"|"activate"){
    if(busy)return;
    const label=mode==="delete"?"Delete":mode==="disable"?"Disable":"Activate";
    const note=mode==="delete"
      ?"This is allowed only when the project has no transaction/history. Customer linking alone does not block deletion."
      :mode==="disable"
        ?"The project has transaction/history and will be retained for audit while becoming unavailable for new operational use."
        :"The project will return to ACTIVE status.";
    if(!window.confirm(`${label} ${projectName} (${projectId})?\n\n${note}`))return;
    setBusy(mode);setMessage("");
    try{
      const response=await fetch("/api/erp/actions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({target:"masters",body:{type:"project",mode,record:{projectId}}}),
      });
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||`Project ${mode} failed`);
      setMessage(mode==="delete"?"Deleted":mode==="disable"?"Disabled":"Activated");
      router.refresh();
    }catch(error){
      setMessage(error instanceof Error?error.message:`Project ${mode} failed`);
    }finally{setBusy("");}
  }

  const normalized=String(status||"").toUpperCase();
  const inactive=normalized==="ON_HOLD"||normalized==="CANCELLED";

  return <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
    {usageCount===0&&<button type="button" className="danger-button" disabled={Boolean(busy)} onClick={()=>void run("delete")}>{busy==="delete"?"Deleting…":"Delete"}</button>}
    {usageCount>0&&!inactive&&<button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void run("disable")}>{busy==="disable"?"Disabling…":"Disable"}</button>}
    {inactive&&<button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void run("activate")}>{busy==="activate"?"Activating…":"Activate"}</button>}
    {message&&<span className="small">{message}</span>}
  </div>;
}
