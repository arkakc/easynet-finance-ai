"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkspaceAction, WorkspaceDefinition, WorkspaceId } from "@/lib/workspaces/module-registry";
import { COMMERCIAL_CATEGORY_ORDER, organizeCommercialActions } from "@/lib/workspaces/commercial-navigation";
import type { WorkspaceRecentDocument } from "@/lib/workspaces/recent-documents.server";

type Props = { workspace: WorkspaceDefinition; actions: WorkspaceAction[]; availableModules: Array<{ id: WorkspaceId; title: string }>; recentDocuments: WorkspaceRecentDocument[]; streamlined?: boolean };

export default function UnifiedModuleWorkspace({ workspace, actions, availableModules, recentDocuments, streamlined = false }: Props) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState(() => {
    if (workspace.id === "sales" || workspace.id === "purchases") return actions.some(action => action.section === "Quotations") ? "Quotations" : "All";
    return actions.find(action => action.section !== "All")?.section || "All";
  });
  const [registerQuery, setRegisterQuery] = useState("");
  const [registerKind, setRegisterKind] = useState("All");
  const [registerStatus, setRegisterStatus] = useState("All");
  const [registerPage, setRegisterPage] = useState(1);
  const [registerSort, setRegisterSort] = useState<"newest" | "oldest" | "amount-high" | "amount-low">("newest");
  const pageSize = 10;
  const commercial = workspace.id === "sales" || workspace.id === "purchases";
  const orderedActions = useMemo(() => organizeCommercialActions(actions, workspace.id), [actions, workspace.id]);
  const sections = useMemo(() => commercial ? [...COMMERCIAL_CATEGORY_ORDER] : [...new Set(orderedActions.map(action => action.section).filter(name => name !== "All")), "All"], [commercial, orderedActions]);
  const visible = useMemo(() => orderedActions.filter(action => {
    if (section !== "All" && action.section !== section) return false;
    const needle = query.toLocaleLowerCase().trim();
    return !needle || [action.title, action.description, action.section].join(" ").toLocaleLowerCase().includes(needle);
  }), [orderedActions, query, section]);
  const primary = orderedActions.find(action => action.kind === "primary") || orderedActions[0];
  const registerKinds = useMemo(() => ["All", ...new Set(recentDocuments.map(row => row.kind))], [recentDocuments]);
  const registerStatuses = useMemo(() => ["All", ...new Set(recentDocuments.map(row => row.status))], [recentDocuments]);
  const visibleDocuments = useMemo(() => recentDocuments.filter(row => {
    if (registerStatus !== "All" && row.status !== registerStatus) return false;
    if (registerKind !== "All" && row.kind !== registerKind) return false;
    const search = registerQuery.trim().toLowerCase();
    return !search || [row.number, row.kind, row.party, row.status, row.currency].join(" ").toLowerCase().includes(search);
  }), [recentDocuments, registerKind, registerQuery, registerStatus]);
  const sortedDocuments = useMemo(() => [...visibleDocuments].sort((a, b) => {
    if (registerSort === "amount-high") return b.amount - a.amount || b.date.localeCompare(a.date);
    if (registerSort === "amount-low") return a.amount - b.amount || b.date.localeCompare(a.date);
    if (registerSort === "oldest") return a.date.localeCompare(b.date) || a.number.localeCompare(b.number);
    return b.date.localeCompare(a.date) || b.number.localeCompare(a.number);
  }), [visibleDocuments, registerSort]);
  const pageCount = Math.max(1, Math.ceil(sortedDocuments.length / pageSize));
  const currentPage = Math.min(registerPage, pageCount);
  const pageDocuments = sortedDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const workflow = useMemo(() => orderedActions.reduce<Array<{ section: string; href: string }>>((items, action) => {
    if (!items.some(item => item.section === action.section)) items.push({ section: action.section, href: action.href });
    return items;
  }, []), [orderedActions]);
  const create = orderedActions.find(action => action.kind === "action");

  const streamlinedLayout = streamlined || workspace.id === "sales";

  return <div className={`unified-module-workspace ${streamlinedLayout ? "ef-compact-workspace" : ""}`}>
    <header className="unified-workspace-header">
      <div>
        <p className="unified-workspace-eyebrow">{workspace.eyebrow}</p>
        <h1>{workspace.title.replace(/ Workspace$/, "")}</h1>
        {!streamlinedLayout && <p>{workspace.description}</p>}
      </div>
      {!streamlinedLayout && <div className="unified-workspace-header-actions">
        {create && <Link prefetch={false} className="link-button" href={create.href}>+ {create.title}</Link>}
        {primary && <Link prefetch={false} className="link-button secondary-link" href={primary.href}>Open {primary.title}</Link>}
      </div>}
    </header>

    {!streamlinedLayout && <nav className="unified-workspace-switcher" aria-label="Module workspaces">
      {availableModules.map(module => <Link
        prefetch={false}
        key={module.id}
        href={`/workspace/${module.id}`}
        aria-current={module.id === workspace.id ? "page" : undefined}
        className={module.id === workspace.id ? "unified-workspace-module active" : "unified-workspace-module"}
      >{module.title.replace(" Workspace", "")}</Link>)}
    </nav>}

    {!streamlinedLayout && <section className="panel unified-workspace-content" aria-label={workspace.title + " workflow"}>
      <div className="unified-workspace-section-head"><div><h2>Workflow at a glance</h2><p className="small">Choose a step to open its existing secured register. Steps shown depend on your permissions.</p></div></div>
      <nav className="unified-workspace-tabs" aria-label="Workflow steps">
        {workflow.map((step, index) => <Link prefetch={false} key={step.section} className="unified-workspace-tab" href={step.href}>{index + 1}. {step.section} <span aria-hidden="true">↗</span></Link>)}
      </nav>
    </section>}
    <section className="panel unified-workspace-content" aria-label={workspace.title + " register shortcuts"}>
      <div className="unified-workspace-section-head">
        <div>
          <h2>Registers & Actions</h2>
          {!streamlinedLayout && <p className="small">Search a document type or choose a workflow. Existing records and posting controls open in their authoritative registers.</p>}
        </div>
        <label className="unified-workspace-search">
          <span className="sr-only">Search workspace actions</span>
          <input value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder="Search registers and actions…" />
        </label>
      </div>
      <div className="unified-workspace-tabs" role="group" aria-label="Filter by work category">
        {sections.map(name => { const available = name === "All" || orderedActions.some(action => action.section === name); return <button type="button" key={name} title={available ? `Show ${name} actions` : `No ${name} actions in this module`} disabled={!available} aria-pressed={section === name} className={section === name ? "unified-workspace-tab selected" : "unified-workspace-tab"} onClick={() => setSection(name)}>{name}</button>; })}
      </div>
      <div className="unified-workspace-register-controls"><span>{visible.length} of {orderedActions.length} available actions</span><button type="button" disabled={section === "All" && !query} onClick={() => { setSection("All"); setQuery(""); }}>Clear action filters</button></div>
      <div className="unified-workspace-action-grid">
        {visible.map(action => action.disabled ? <div key={action.href + action.title} className="unified-workspace-action ef-workspace-action-disabled" aria-disabled="true" title={action.disabledReason || "This action is unavailable"}>
          <span className="unified-workspace-action-category">{action.section}</span>
          <span className="unified-workspace-action-title">{action.title}</span>
          <span className="unified-workspace-action-description">{action.disabledReason || action.description}</span>
        </div> : <Link key={action.href + action.title} prefetch={false} href={action.href} className="unified-workspace-action">
          <span className="unified-workspace-action-category">{action.section}</span>
          <span className="unified-workspace-action-title">{action.title}<span aria-hidden="true"> ↗</span></span>
          <span className="unified-workspace-action-description">{action.description}</span>
        </Link>)}
        {!visible.length && <p className="unified-workspace-empty">No matching registers. Try another search or category.</p>}
      </div>
    </section>
    {(workspace.id === "sales" || workspace.id === "purchases") && <section className="panel unified-workspace-content unified-workspace-recent" aria-label="Recent business documents">
      <div className="unified-workspace-section-head">
        <div><h2>Recent Documents</h2>{!streamlinedLayout && <p className="small">Read-only preview of up to 40 recent records. Use the register above for full history, approval and posting.</p>}</div>
        <label className="unified-workspace-search"><span className="sr-only">Search recent documents</span><input type="search" value={registerQuery} onChange={event => { setRegisterQuery(event.target.value); setRegisterPage(1); }} placeholder="Search number, party or status…" /></label>
      </div>
      <div className="unified-workspace-tabs" role="group" aria-label="Filter recent document type">
        {registerKinds.map(kind => <button type="button" key={kind} className={registerKind === kind ? "unified-workspace-tab selected" : "unified-workspace-tab"} aria-pressed={registerKind === kind} onClick={() => { setRegisterKind(kind); setRegisterPage(1); }}>{kind}</button>)}
      </div>
      <div className="unified-workspace-register-controls"><label>Status <select value={registerStatus} onChange={event => { setRegisterStatus(event.target.value); setRegisterPage(1); }}>{registerStatuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label><label>Sort <select value={registerSort} onChange={event => { setRegisterSort(event.target.value as typeof registerSort); setRegisterPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-high">Amount: high to low</option><option value="amount-low">Amount: low to high</option></select></label><button type="button" disabled={!registerQuery && registerKind === "All" && registerStatus === "All" && registerSort === "newest"} onClick={() => { setRegisterQuery(""); setRegisterKind("All"); setRegisterStatus("All"); setRegisterSort("newest"); setRegisterPage(1); }}>Clear register filters</button><span>{visibleDocuments.length} of {recentDocuments.length} recent documents</span></div>
      <div className="table-wrap">
        <table className="data-table unified-workspace-register">
          <thead><tr><th>Document No</th><th>Type</th><th>Party</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{pageDocuments.map(doc => <tr key={doc.kind + doc.id}>
            <td><Link prefetch={false} href={doc.href} className="linked-document-id">{doc.number}</Link></td>
            <td>{doc.kind}</td><td>{doc.party}</td><td>{doc.date}</td><td className="unified-workspace-amount">{new Intl.NumberFormat("en-PG", {style:"currency",currency:doc.currency || "PGK"}).format(doc.amount)}</td><td><span className="auto-badge">{doc.status}</span></td>
          </tr>)}
          {!visibleDocuments.length && <tr><td colSpan={6}>No matching recent documents.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="unified-workspace-pagination"><span>Page {currentPage} of {pageCount} · Showing {pageDocuments.length} records</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setRegisterPage(page => Math.max(1, page - 1))}>Previous</button><button type="button" disabled={currentPage >= pageCount} onClick={() => setRegisterPage(page => Math.min(pageCount, page + 1))}>Next</button></div></div>
    </section>}
    <p className="small unified-workspace-footnote">Workspace shortcuts do not create financial entries. Approvals, validation, posting, and ledger changes stay in existing secured transaction workflows.</p>
  </div>;
}
