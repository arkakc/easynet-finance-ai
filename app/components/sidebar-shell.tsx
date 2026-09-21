"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CollapsibleSidebarNav, { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";
import LogoutButton from "@/app/components/logout-button";

type Props = {
  groups: SidebarNavGroup[];
  homeHref: string;
  userName: string;
  userRoles: string[];
};

const STORAGE_KEY = "easynet-sidebar-collapsed";

export default function SidebarShell({ groups, homeHref, userName, userRoles }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
      <div className="sidebar-top">
        <Link prefetch={false} className="brand" href={homeHref} title={collapsed ? "Easynet Finance AI" : undefined}>
          <div className="brand-icon">EN</div>
          <div className="brand-copy">
            <strong>EASYNET FINANCE AI</strong>
            <span>Enterprise Mini ERP · PGK</span>
          </div>
        </Link>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Show navigation" : "Hide navigation"}
          title={collapsed ? "Show navigation" : "Hide navigation"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <CollapsibleSidebarNav groups={groups} compact={collapsed} />

      <div className="sidebar-user">
        <div className="sidebar-user-header">
          <div className="sidebar-user-avatar">{userName ? userName.charAt(0).toUpperCase() : "U"}</div>
          <div className="sidebar-user-info">
            <strong>{userName}</strong>
            <span>{userRoles.join(", ")}</span>
          </div>
        </div>
        <div className="sidebar-logout-wrap">
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
