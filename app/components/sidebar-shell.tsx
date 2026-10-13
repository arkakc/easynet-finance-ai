"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CollapsibleSidebarNav, { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";

type Props = {
  groups: SidebarNavGroup[];
  homeHref: string;
};

export default function SidebarShell({ groups, homeHref }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return <>
    <button className="en-mobile-nav-toggle no-print" type="button" aria-controls="en-sidebar-navigation"
      aria-expanded={mobileOpen} onClick={() => setMobileOpen(current => !current)}>
      {mobileOpen ? "✕ Close menu" : "☰ Menu"}
    </button>
    <aside id="en-sidebar-navigation" className={`sidebar sidebar-auto-hide en-phase1-sidebar ${mobileOpen ? "en-mobile-open" : ""}`}>
      <Link prefetch={false} className="brand" href={homeHref}>
        <div className="brand-icon">EN</div>
        <div className="brand-copy">
          <strong>EASYNET FINANCE AI</strong>
          <span>Enterprise Mini ERP · PGK</span>
        </div>
      </Link>
      <CollapsibleSidebarNav groups={groups}/>
    </aside>
  </>;
}
