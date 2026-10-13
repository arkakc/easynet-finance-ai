import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared visual header for saved ERP documents.
 * Display only: no approval, posting, payment, or destructive business logic.
 */
export default function DocumentIdentityHeader({
  title, number, status, loading = false, journalId, actions, eyebrow = "EASYNET IT SOLUTIONS LIMITED",
}: {
  title: string;
  number: string;
  status: string;
  loading?: boolean;
  journalId?: string | null;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  const resolvedStatus = loading ? "LOADING" : status;
  return (
    <header className="document-header">
      <div className="document-header-main">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <div className="document-header-subline">
          <span className="document-number">{number}</span>
          <span className="document-type-note">Finance document</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {journalId?.trim() && (
          <Link
            prefetch={false}
            className="button-link secondary-link no-print"
            href={`/journals/${encodeURIComponent(journalId)}`}
            title="Open corresponding Journal Entry"
          >
            Journal Entry · {journalId}
          </Link>
        )}
        <span className={`status-pill status-${resolvedStatus.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`}>
          {resolvedStatus}
        </span>
        {actions}
      </div>
    </header>
  );
}
