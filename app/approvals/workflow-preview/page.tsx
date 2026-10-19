"use client";

import { useMemo, useState } from "react";
import { pendingValuePgk, visibleApprovalRows, type ApprovalInboxRow } from "@/lib/workflow/erp-approval-inbox";
import type { ErpRole } from "@/lib/workflow/erp-approval-policy";

const samples: ApprovalInboxRow[] = [
  { id:"demo-po",companyId:"demo-company",documentKind:"PURCHASE_ORDER",documentNo:"PO-DEMO-001",amountPgk:25000,creatorUserId:"maker-po",status:"UNDER_REVIEW",requiredRole:"SUPPLY_CHAIN_MANAGER",policyVersion:1,updatedAt:"2026-10-19T08:10:00Z" },
  { id:"demo-bill",companyId:"demo-company",documentKind:"SUPPLIER_BILL",documentNo:"BILL-DEMO-002",amountPgk:16000,creatorUserId:"maker-ap",status:"UNDER_REVIEW",requiredRole:"CFO",policyVersion:1,updatedAt:"2026-10-19T08:20:00Z" },
  { id:"demo-grn",companyId:"demo-company",documentKind:"GOODS_RECEIPT",documentNo:"GRN-DEMO-003",amountPgk:8000,creatorUserId:"maker-stock",status:"SUBMITTED",requiredRole:"INVENTORY_MANAGER",policyVersion:1,updatedAt:"2026-10-19T08:30:00Z" },
  { id:"demo-journal",companyId:"demo-company",documentKind:"MANUAL_JOURNAL",documentNo:"JNL-DEMO-004",amountPgk:4500,creatorUserId:"maker-finance",status:"UNDER_REVIEW",requiredRole:"FINANCE_CONTROLLER",policyVersion:1,updatedAt:"2026-10-19T08:40:00Z" },
];
const roles: { value: ErpRole; label: string }[] = [
  {value:"FINANCE_OFFICER_AP",label:"Finance Officer AP"},
  {value:"FINANCE_OFFICER_AR",label:"Finance Officer AR"},
  {value:"FINANCE_CONTROLLER",label:"Finance Controller"},
  {value:"CFO",label:"CFO"},
  {value:"INVENTORY_CONTROLLER",label:"Inventory Controller"},
  {value:"INVENTORY_MANAGER",label:"Inventory Manager"},
  {value:"SUPPLY_CHAIN_OFFICER",label:"Supply Chain Officer"},
  {value:"SUPPLY_CHAIN_MANAGER",label:"Supply Chain Manager"},
  {value:"CEO",label:"CEO"},
];

export default function ApprovalWorkflowPreviewPage() {
  const [role,setRole]=useState<ErpRole>("FINANCE_CONTROLLER");
  const [query,setQuery]=useState("");
  const visible=useMemo(()=>visibleApprovalRows(samples,{companyId:"demo-company",userId:"demo-reviewer",roles:[role]}).filter((r)=>`${r.documentNo} ${r.documentKind}`.toLowerCase().includes(query.toLowerCase())),[role,query]);
  return <main style={{display:"grid",gap:18}}>
    <header className="page-head">
      <div>
        <h2>Approval Workflow — UI Preview</h2>
        <p className="small">Demonstration records only. No live documents, user permissions, approvals or accounting posting are connected.</p>
      </div>
    </header>
    <section className="panel" style={{display:"grid",gap:12}}>
      <div className="form-title-row"><h3>My Approval Inbox — Concept</h3><span className="auto-badge">READ-ONLY DEMO</span></div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
        <label style={{display:"grid",gap:5}}>Preview role
          <select value={role} onChange={(e)=>setRole(e.target.value as ErpRole)}>
            {roles.map((r)=><option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label style={{display:"grid",gap:5}}>Filter documents
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search document type or number"/>
        </label>
      </div>
      <div className="grid">
        <div className="card"><div className="label">Assigned to role</div><div className="value">{visible.length}</div></div>
        <div className="card"><div className="label">Illustrative pending value</div><div className="value">K{pendingValuePgk(visible).toLocaleString("en-PG",{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Document</th><th>Type</th><th>Amount (PGK)</th><th>Status</th><th>Next reviewer role</th><th>Action</th></tr></thead>
          <tbody>
            {visible.map((r)=><tr key={r.id}><td><strong>{r.documentNo}</strong></td><td>{r.documentKind.replaceAll("_"," ")}</td><td>K{r.amountPgk.toFixed(2)}</td><td>{r.status}</td><td>{r.requiredRole?.replaceAll("_"," ")}</td><td>Review only — actions disabled</td></tr>)}
            {!visible.length&&<tr><td colSpan={6}>No illustrative approvals for this role.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
    <section className="panel">
      <h3>Approval actions intentionally unavailable</h3>
      <p className="small">Submit, Approve, Return, Reject, Release and Cancel will be enabled only after real company-scoped roles, persistent steps, risk checks, audit history, permission guards and end-to-end UAT are complete. The existing approvals workspace remains unchanged.</p>
    </section>
  </main>;
}
