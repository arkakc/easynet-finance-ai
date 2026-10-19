"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { permittedRoleNavigation } from "@/lib/workflow/erp-role-navigation";
type Company = {companyId:string;roles:string[]};
type Capability = {name:string;actions:string[]};
type Snapshot = {ok:boolean;roles:string[];documentTypes:Capability[];accountingFunctions:Capability[];error?:string};
export default function RoleAccessPage() {
  const [companies,setCompanies]=useState<Company[]>([]);
  const [companyId,setCompanyId]=useState("");
  const [data,setData]=useState<Snapshot|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{let active=true;void fetch("/api/erp/my-company-roles",{cache:"no-store"}).then(r=>r.json()).then(body=>{
    if(!active)return;if(!body.ok)throw new Error(body.error||"Role lookup failed");
    setCompanies(body.companies||[]);setCompanyId(body.companies?.[0]?.companyId||"");
  }).catch(e=>{if(active)setError(e instanceof Error?e.message:"Error")});return()=>{active=false}},[]);
  useEffect(()=>{if(!companyId)return;let active=true;void fetch("/api/erp/role-capabilities?companyId="+encodeURIComponent(companyId),{cache:"no-store"}).then(r=>r.json()).then(body=>{if(active){if(!body.ok)throw new Error(body.error||"Permission lookup failed");setData(body)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Error")});return()=>{active=false}},[companyId]);
  return <main style={{display:"grid",gap:18}}>
    <header className="page-head"><div><h2>My Role Permissions</h2><p className="small">Read-only authenticated view of company-scoped DocType and accounting function privileges. This view does not override existing backend permissions.</p></div></header>
    <section className="panel">
      <label>Assigned company <select value={companyId} onChange={e=>{setCompanyId(e.target.value);setData(null);setError("")}}>{companies.map(c=><option key={c.companyId} value={c.companyId}>{c.companyId}</option>)}</select></label>
      {error&&<p role="alert">{error}</p>}
      {!companies.length&&<p>No active ERP company roles assigned yet.</p>}
      {data&&<p>Assigned roles: {data.roles.join(", ")||"None"}</p>}
    </section>
    {data&&<section className="panel"><h3>Permitted Workspaces — Navigation Preview</h3><p className="small">Links reflect assigned capability visibility only. Each destination applies its own existing server permissions; a link is not a grant.</p><div className="button-row">{permittedRoleNavigation(data.documentTypes,data.accountingFunctions).map(link=><Link className="button-link secondary-link" href={link.href} key={link.label}>{link.label}</Link>)}</div></section>}
    {data&&[["DocType Access",data.documentTypes],["Accounting Functions",data.accountingFunctions]] .map(([heading,rows])=><section className="panel" key={heading as string}><h3>{heading as string}</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Allowed actions</th></tr></thead><tbody>{(rows as Capability[]).map(row=><tr key={row.name}><td>{row.name.replaceAll("_"," ")}</td><td>{row.actions.join(" · ")}</td></tr>)}{!(rows as Capability[]).length&&<tr><td colSpan={2}>No access assigned</td></tr>}</tbody></table></div></section>)}
  </main>;
}
