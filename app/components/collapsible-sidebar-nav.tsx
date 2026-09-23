"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type SidebarNavGroup = {
  label: string;
  icon: string;
  links: { label: string; href: string; disabled?: boolean; disabledReason?: string }[];
};

type Props = {
  groups: SidebarNavGroup[];
  compact?: boolean;
};

const AUTO_COLLAPSE_MS = 30_000;

function hrefIsActive(href: string, pathname: string, searchParams: URLSearchParams) {
  const [hrefPath, hrefQuery] = href.split("?");
  if (hrefPath !== pathname) return false;
  if (!hrefQuery) return true;
  const params = new URLSearchParams(hrefQuery);
  for (const [key, value] of params.entries()) {
    if (searchParams.get(key) !== value) return false;
  }
  return true;
}

export default function CollapsibleSidebarNav({ groups, compact = false }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const autoCollapseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    for (const [label, timer] of autoCollapseTimers.current.entries()) {
      if (!expanded.has(label)) {
        clearTimeout(timer);
        autoCollapseTimers.current.delete(label);
      }
    }
    for (const label of expanded) {
      if (autoCollapseTimers.current.has(label)) continue;
      const timer = setTimeout(() => {
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(label);
          return next;
        });
        autoCollapseTimers.current.delete(label);
      }, AUTO_COLLAPSE_MS);
      autoCollapseTimers.current.set(label, timer);
    }
  }, [expanded]);

  useEffect(() => () => {
    for (const timer of autoCollapseTimers.current.values()) clearTimeout(timer);
    autoCollapseTimers.current.clear();
  }, []);

  const toggle = (label: string) => {
    if (compact) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        const existingTimer = autoCollapseTimers.current.get(label);
        if (existingTimer) {
          clearTimeout(existingTimer);
          autoCollapseTimers.current.delete(label);
        }
        next.add(label);
      }
      return next;
    });
  };

  return <nav>
    {groups.map((group) => {
      const isCollapsed = compact || !expanded.has(group.label);
      return <div className={`nav-section ${isCollapsed ? "collapsed" : "expanded"} ${compact ? "nav-section-compact" : ""}`} key={group.label} title={compact ? group.label : undefined}>
        <button type="button" className="nav-label" onClick={() => toggle(group.label)} aria-expanded={!isCollapsed} aria-controls={`nav-section-${group.label.replace(/\W+/g, "-").toLowerCase()}`} aria-label={compact ? group.label : undefined}>
          <span className="nav-label-main">
            <span className="nav-section-icon">{group.icon}</span>
            <span className="nav-label-text">{group.label}</span>
          </span>
        </button>
        <div className="nav-links" id={`nav-section-${group.label.replace(/\W+/g, "-").toLowerCase()}`}>
          {group.links.map((link) => link.disabled ? (
            <span key={`${group.label}-${link.label}`} className="nav-disabled-link" aria-disabled="true" title={link.disabledReason || "Unavailable"}>
              {link.label}
            </span>
          ) : (
            <Link prefetch={false} href={link.href} key={`${group.label}-${link.label}`} className={hrefIsActive(link.href, pathname, searchParams) ? "active" : undefined}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>;
    })}
  </nav>;
}
