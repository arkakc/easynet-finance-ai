import type { ReactNode } from "react";

/** Shared placement for authorized, document-specific actions. Business rules remain with the caller. */
export default function DocumentActionBar({ back, notice, children }: {
  back: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return <div className="document-toolbar no-print" aria-label="Document actions">
    <div className="document-toolbar-back">{back}</div>
    <div className="row-actions">{notice}{children}</div>
  </div>;
}
