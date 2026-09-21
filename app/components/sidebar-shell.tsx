"use client";

import Link from "next/link";
import CollapsibleSidebarNav, { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";
import LogoutButton from "@/app/components/logout-button";

type Props = {
  groups: SidebarNavGroup[];
  homeHref: string;
  userName: string;
  userRoles: string[];
};

export default function SidebarShell({ groups, homeHref, userName, userRoles }: Props) {
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

        <div className="sidebar-user">
          <div className="sidebar-user-header">
            <div className="sidebar-user-avatar">{userName ? userName.charAt(0).toUpperCase() : "U"}</div>
            <div className="sidebar-user-info">
              <strong>{userName}</strong>
              <span>{userRoles.join(", ")}</span>
            </div>
          </div>
          <div className="sidebar-logout-wrap"><LogoutButton /></div>
        </div>
      </aside>
    </>
  );
}
