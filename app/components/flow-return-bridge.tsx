"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const KEY="easynet-finance-flow-return";
const LABEL_KEY="easynet-finance-flow-return-label";

export default function FlowReturnBridge(){
  const pathname=usePathname();
  const[href,setHref]=useState(""),[label,setLabel]=useState("Return to Previous Flow");

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const incoming=params.get("flowReturn")||"";
    const incomingLabel=params.get("flowReturnLabel")||"Return to Previous Flow";
    if(incoming.startsWith("/")){
      sessionStorage.setItem(KEY,incoming);
      sessionStorage.setItem(LABEL_KEY,incomingLabel);
      setHref(incoming);setLabel(incomingLabel);
      return;
    }
    const stored=sessionStorage.getItem(KEY)||"";
    const storedLabel=sessionStorage.getItem(LABEL_KEY)||"Return to Previous Flow";
    if(stored){
      try{
        const targetPath=new URL(stored,window.location.origin).pathname;
        if(targetPath===pathname){sessionStorage.removeItem(KEY);sessionStorage.removeItem(LABEL_KEY);setHref("");return;}
      }catch{}
      setHref(stored);setLabel(storedLabel);
    }else setHref("");
  },[pathname]);

  if(!href)return null;
  return <div className="no-print" style={{marginBottom:14,padding:"10px 12px",border:"1px solid #cbd5e1",borderRadius:10,background:"#f8fafc",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
    <div><strong>Active Process Navigation</strong><span className="small" style={{display:"block"}}>You opened this supporting step from another business flow. Return when this step is complete.</span></div>
    <div className="button-row">
      <Link className="button-link" href={href} onClick={()=>{sessionStorage.removeItem(KEY);sessionStorage.removeItem(LABEL_KEY);}}>{`← ${label}`}</Link>
      <button type="button" className="secondary" onClick={()=>{sessionStorage.removeItem(KEY);sessionStorage.removeItem(LABEL_KEY);setHref("");}}>Clear Return Link</button>
    </div>
  </div>;
}
