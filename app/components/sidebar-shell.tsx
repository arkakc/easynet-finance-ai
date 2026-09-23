"use client";

import Link from "next/link";
import CollapsibleSidebarNav, { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";

type Props = {
  groups: SidebarNavGroup[];
  homeHref: string;
};

export default function SidebarShell({ groups, homeHref }: Props) {
  return (
    <>
      <div className="sidebar-hover-zone" aria-hidden="true" />
      <aside className="sidebar sidebar-auto-hide">
        <Link prefetch={false} className="brand" href={homeHref}>
          <div className="brand-icon">EN</div>
          <div className="brand-copy">
            <strong>EASYNET FINANCE AI</strong>
            <span>Enterprise Mini ERP · PGK</span>
          </div>
        </Link>

        <CollapsibleSidebarNav groups={groups} />

      </aside>
    </>
  );
}
