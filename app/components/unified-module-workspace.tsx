"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkspaceAction, WorkspaceDefinition, WorkspaceId } from "@/lib/workspaces/module-registry";
import type { WorkspaceRecentDocument } from "@/lib/workspaces/recent-documents.server";

type Props = { workspace: WorkspaceDefinition; actions: WorkspaceAction[]; availableModules: Array<{ id: WorkspaceId; title: string }>; recentDocuments: WorkspaceRecentDocument[] };

export default function UnifiedModuleWorkspace({ workspace, actions, availableModules, recentDocuments }: Props) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("All");
  const [registerQuery, setRegisterQuery] = useState("");
  const [registerKind, setRegisterKind] = useState("All");
  const sections = useMemo(() => ["All", ...new Set(actions.map(action => action.section))], [actions]);
  const visible = useMemo(() => actions.filter(action => {
    if (section !== "All" && action.section !== section) return false;
    const needle = query.toLocaleLowerCase().trim();
    return !needle || [action.title, action.description, action.section].join(" ").toLocaleLowerCase().includes(needle);
  }), [actions, query, section]);
  const primary = actions.find(action => action.kind === "primary") || actions[0];
  const registerKinds = useMemo(() => ["All", ...new Set(recentDocuments.map(row => row.kind))], [recentDocuments]);
  const visibleDocuments = useMemo(() => recentDocuments.filter(row => {
    if (registerKind !== "All" && row.kind !== registerKind) return false;
    const search = registerQuery.trim().toLowerCase();
    return !search || [row.number, row.kind, row.party, row.status, row.currency].join(" ").toLowerCase().includes(search);
  }), [recentDocuments, registerKind, registerQuery]);
  const create = actions.find(action => action.kind === "action");

  return <div className="unified-module-workspace">
    <header className="unified-workspace-header">
      <div>
        <p className="unified-workspace-eyebrow">{workspace.eyebrow}</p>
        <h1>{workspace.title}</h1>
        <p>{workspace.description}</p>
      </div>
      <div className="unified-workspace-header-actions">
        {create && <Link prefetch={false} className="link-button" href={create.href}>+ {create.title}</Link>}
        {primary && <Link prefetch={false} className="link-button secondary-link" href={primary.href}>Open {primary.title}</Link>}
      </div>
    </header>

    <nav className="unified-workspace-switcher" aria-label="Module workspaces">
      {availableModules.map(module => <Link
        prefetch={false}
        key={module.id}
        href={`/workspace/${module.id}`}
        aria-current={module.id === workspace.id ? "page" : undefined}
        className={module.id === workspace.id ? "unified-workspace-module active" : "unified-workspace-module"}
      >{module.title.replace(" Workspace", "")}</Link>)}
    </nav>

    <section className="panel unified-workspace-content" aria-label={workspace.title + " register shortcuts"}>
      <div className="unified-workspace-section-head">
        <div>
          <h2>Registers & Actions</h2>
          <p className="small">Search a document type or choose a workflow. Existing records and posting controls open in their authoritative registers.</p>
        </div>
        <label className="unified-workspace-search">
          <span className="sr-only">Search workspace actions</span>
          <input value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder="Search registers and actions…" />
        </label>
      </div>
      <div className="unified-workspace-tabs" role="group" aria-label="Filter by work category">
        {sections.map(name => <button type="button" key={name} aria-pressed={section === name} className={section === name ? "unified-workspace-tab selected" : "unified-workspace-tab"} onClick={() => setSection(name)}>{name}</button>)}
      </div>
      <div className="unified-workspace-action-grid">
        {visible.map(action => <Link key={action.href + action.title} prefetch={false} href={action.href} className="unified-workspace-action">
          <span className="unified-workspace-action-category">{action.section}</span>
          <span className="unified-workspace-action-title">{action.title}<span aria-hidden="true"> ↗</span></span>
          <span className="unified-workspace-action-description">{action.description}</span>
        </Link>)}
        {!visible.length && <p className="unified-workspace-empty">No matching registers. Try another search or category.</p>}
      </div>
    </section>
    {(workspace.id === "sales" || workspace.id === "purchases") && <section className="panel unified-workspace-content unified-workspace-recent" aria-label="Recent business documents">
      <div className="unified-workspace-section-head">
        <div><h2>Recent Documents</h2><p className="small">Read-only preview of up to 40 recent records. Use the register above for full history, approval and posting.</p></div>
        <label className="unified-workspace-search"><span className="sr-only">Search recent documents</span><input type="search" value={registerQuery} onChange={event => setRegisterQuery(event.target.value)} placeholder="Search number, party or status…" /></label>
      </div>
      <div className="unified-workspace-tabs" role="group" aria-label="Filter recent document type">
        {registerKinds.map(kind => <button type="button" key={kind} className={registerKind === kind ? "unified-workspace-tab selected" : "unified-workspace-tab"} aria-pressed={registerKind === kind} onClick={() => setRegisterKind(kind)}>{kind}</button>)}
      </div>
      <div className="table-wrap">
        <table className="data-table unified-workspace-register">
          <thead><tr><th>Document No</th><th>Type</th><th>Party</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{visibleDocuments.map(doc => <tr key={doc.kind + doc.id}>
            <td><Link prefetch={false} href={doc.href} className="linked-document-id">{doc.number}</Link></td>
            <td>{doc.kind}</td><td>{doc.party}</td><td>{doc.date}</td><td className="unified-workspace-amount">{new Intl.NumberFormat("en-PG", {style:"currency",currency:doc.currency || "PGK"}).format(doc.amount)}</td><td><span className="auto-badge">{doc.status}</span></td>
          </tr>)}
          {!visibleDocuments.length && <tr><td colSpan={6}>No matching recent documents.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>}
    <p className="small unified-workspace-footnote">Workspace shortcuts do not create financial entries. Approvals, validation, posting, and ledger changes stay in existing secured transaction workflows.</p>
  </div>;
}
