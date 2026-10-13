"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";

function safePath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  return value;
}

export default function GlobalNavigationBar({ groups }: { groups: SidebarNavGroup[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const candidates = useMemo(() => groups.flatMap(group => group.links
    .filter(link => !link.disabled)
    .map(link => ({ ...link, group: group.label }))), [groups]);
  const current = candidates.find(link => link.href.split("?")[0] === pathname);
  const hits = candidates.filter(link => `${link.label} ${link.group}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);

  useEffect(() => {
    const key = "easynet:recent-pages:v1";
    try {
      const previous = JSON.parse(window.sessionStorage.getItem(key) || "[]") as string[];
      const next = [pathname + (params.toString() ? `?${params.toString()}` : ""), ...previous.filter(x => x !== pathname)].slice(0, 8);
      window.sessionStorage.setItem(key, JSON.stringify(next));
      setRecent(next);
    } catch { setRecent([]); }
  }, [pathname, params]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowSearch(true);
      }
      if (event.key === "Escape") setShowSearch(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function navigate(href: string) {
    setShowSearch(false);
    setQuery("");
    router.push(href);
  }

  const previous = recent.find(href => safePath(href) && href.split("?")[0] !== pathname);
  const quickCreate = [
    {label:"Sales Quotation",permission:"Sales Workspace",url:"/transactions?module=sales&tab=salesQuote&mode=create"},
    {label:"Sales Invoice",permission:"Sales Workspace",url:"/transactions?module=sales&tab=salesInvoice&mode=create"},
    {label:"Customer Receipt",permission:"Sales Workspace",url:"/transactions?module=sales&tab=salesPayment&mode=create"},
    {label:"Supplier Quotation",permission:"Purchases Workspace",url:"/transactions?module=purchase&tab=supplierQuote&mode=create"},
    {label:"Purchase Order",permission:"Purchases Workspace",url:"/transactions?module=purchase&tab=purchaseOrder&mode=create"},
    {label:"Supplier Invoice",permission:"Purchases Workspace",url:"/transactions?module=purchase&tab=supplierInvoice&mode=create"},
    {label:"Supplier Payment",permission:"Purchases Workspace",url:"/transactions?module=purchase&tab=purchasePayment&mode=create"},
    {label:"Expense",permission:"Expenses",url:"/transactions?module=expense&tab=expense&mode=create"},
  ].filter(item => candidates.some(link => link.label === item.permission));
  return <div className="en-navigation-topbar no-print">
    <div className="en-nav-breadcrumb">
      <Link href="/dashboard" prefetch={false}>Home</Link>
      <span aria-hidden="true">/</span>
      <span>{current?.group || "Workspace"}</span>
      <span aria-hidden="true">/</span>
      <strong>{current?.label || pathname.split("/").filter(Boolean).slice(-1)[0] || "Overview"}</strong>
    </div>
    <div className="en-nav-controls">
      {previous && <button type="button" className="secondary" onClick={() => navigate(previous)} title="Return to your previous workspace">← Back</button>}
      {quickCreate.length > 0 && <div className="en-quick-create"><button type="button" onClick={() => setShowCreate(value => !value)} aria-expanded={showCreate} aria-haspopup="menu">+ New</button>{showCreate && <div className="en-quick-create-menu" role="menu">{quickCreate.map(item => <button type="button" role="menuitem" key={item.label} onClick={() => {setShowCreate(false);navigate(item.url);}}>{item.label}</button>)}</div>}</div>}
      <button type="button" className="secondary" onClick={() => setShowSearch(true)} aria-label="Search modules and pages">Search pages <kbd>Ctrl K</kbd></button>
      {showSearch && <div className="en-global-search-overlay" role="presentation" onClick={() => setShowSearch(false)}>
        <div className="en-global-search-dialog" role="dialog" aria-modal="true" aria-label="Navigation search" onClick={event => event.stopPropagation()}>
          <label htmlFor="en-global-page-search">Find a workspace or page</label>
          <input id="en-global-page-search" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Sales, Purchases, Journals, GST..." />
          <div className="en-global-search-results">
            {hits.map(hit => <button type="button" key={hit.href} onClick={() => navigate(hit.href)}>
              <span>{hit.label}</span><small>{hit.group}</small>
            </button>)}
            {hits.length === 0 && <p>No matching pages. Search currently covers permitted navigation, not transaction records.</p>}
          </div>
          <button type="button" className="secondary" onClick={() => setShowSearch(false)}>Close</button>
        </div>
      </div>}
    </div>
  </div>;
}
