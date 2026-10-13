"use client";

import Link from "next/link";
import { useState } from "react";

type LinkRow = { direction?: string; label?: string; stage?: number; id?: string; number?: string; href?: string; type?: string };
export default function DocumentChainNavigator({ links, explorerHref, currentNumber }: { links: LinkRow[]; explorerHref: string; currentNumber: string }) {
  const [copied, setCopied] = useState(false);
  const valid = links.filter(link => link.href?.startsWith("/") && !link.href.startsWith("//") && link.id && link.number);
  const ordered = [...valid].sort((a, b) => Number(a.stage || 0) - Number(b.stage || 0));
  const previous = [...ordered].reverse().find(link => link.direction === "previous");
  const next = ordered.find(link => link.direction === "next");
  async function copyChain() {
    try {
      await navigator.clipboard.writeText(new URL(explorerHref, window.location.origin).toString());
      setCopied(true);
    } catch { setCopied(false); }
  }
  return <nav aria-label="Document chain quick navigation" className="panel no-print phase4-chain-nav" style={{ marginTop: 16 }}>
    <div className="form-title-row">
      <div><h2 style={{ margin: 0 }}>Document Chain</h2><p className="small">Current: {currentNumber} · Jump to verified linked documents</p></div>
      <Link prefetch={false} href={explorerHref}>Full relationship explorer ↗</Link>
    </div>
    <div className="button-row" style={{ flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {previous ? <Link className="button-link secondary-link" prefetch={false} href={previous.href!}>← {previous.label || "Previous"} · {previous.number}</Link> : <span className="small">No earlier linked document</span>}
      {next ? <Link className="button-link secondary-link" prefetch={false} href={next.href!}>{next.label || "Next"} · {next.number} →</Link> : <span className="small">No later linked document</span>}
      <button type="button" onClick={() => void copyChain()}>{copied ? "Link copied" : "Copy chain link"}</button>
    </div>
    {ordered.length > 0 && <details style={{ marginTop: 12 }}>
      <summary>All related documents ({ordered.length})</summary>
      <ul>{ordered.map((link, i) => <li key={`${link.type}-${link.id}-${i}`}><Link prefetch={false} href={link.href!}>{link.label || link.type} · {link.number}</Link></li>)}</ul>
    </details>}
  </nav>;
}
