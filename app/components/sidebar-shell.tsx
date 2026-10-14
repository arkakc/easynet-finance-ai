"use client";

import Link from "next/link";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import CollapsibleSidebarNav, { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";

type Props = { groups: SidebarNavGroup[]; homeHref: string };

export default function SidebarShell({ groups, homeHref }: Props) {
  const [pinned, setPinned] = useState(false);
  return (
    <aside className={`sidebar sidebar-navigation-refresh ef-slide-sidebar ${pinned ? "ef-slide-pinned" : ""}`} aria-label="Main navigation">
      <div className="ef-sidebar-head">
        <Link prefetch={false} className="brand" href={homeHref} aria-label="Easynet Finance Home">
          <div className="brand-icon">EN</div>
          <div className="brand-copy"><strong>EASYNET FINANCE AI</strong><span>Enterprise Mini ERP · PGK</span></div>
        </Link>
        <button type="button" className="ef-sidebar-pin" onClick={() => setPinned(value => !value)}
          title={pinned ? "Unpin sidebar (auto-collapse)" : "Keep sidebar expanded"}
          aria-label={pinned ? "Unpin sidebar" : "Pin expanded sidebar"} aria-pressed={pinned}>
          {pinned ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}
        </button>
      </div>
      <CollapsibleSidebarNav groups={groups}/>
    </aside>
  );
}
