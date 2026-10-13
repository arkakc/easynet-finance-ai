"use client";

import Link from "next/link";
import { useMemo } from "react";
import { suggestNextActions } from "@/lib/erp/intelligent-next-actions";

type Relationship = { type?: string; href?: string; direction?: string; label?: string };
export default function IntelligentNextActions({ type, id, status, number, partyType, links }: {
  type: string; id: string; status: string; number?: string; partyType?: string; links: Relationship[];
}) {
  const actions = useMemo(() => suggestNextActions({ type, id, status, number, partyType, links }), [type, id, status, number, partyType, links]);
  if (!actions.length) return null;
  return <section className="panel no-print" aria-label="Suggested next document actions" style={{ marginTop: 16 }}>
    <div className="form-title-row">
      <div><h2 style={{ margin: 0 }}>Suggested Next Steps</h2><p className="small">Based on document status and linked records. Suggestions do not create, approve or post anything automatically.</p></div>
      <span className="auto-badge">{actions.length} AVAILABLE</span>
    </div>
    <div className="button-row" style={{ flexWrap: "wrap", gap: 8 }}>
      {actions.map(item => <Link key={item.key} prefetch={false} className="button-link secondary-link" title={item.description} href={item.href}>{item.label} →</Link>)}
    </div>
  </section>;
}
