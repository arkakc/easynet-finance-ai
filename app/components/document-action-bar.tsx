import type { ReactNode } from "react";

/** Shared placement for authorized, document-specific actions. Business rules remain with the caller. */
export default function DocumentActionBar({ back, notice, children, status }: {
  back: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  status?: string;
}) {
  return <div className="document-toolbar no-print" aria-label="Document actions">
    <div className="document-toolbar-back">{back}</div>
    <div className="row-actions">{status && <span className="auto-badge" aria-label={`Document status: ${status}`}>{status}</span>}{notice}{children}</div>
  </div>;
}
