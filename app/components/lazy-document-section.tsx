"use client";

import { ReactNode, useState } from "react";

type Props = {
  title: string;
  description?: string;
  buttonLabel: string;
  children: ReactNode;
};

export default function LazyDocumentSection({ title, description, buttonLabel, children }: Props) {
  const autoOpen = title === "Payment / Receipt Finalization";
  const [open, setOpen] = useState(autoOpen);

  if (open) return <>{children}</>;

  return (
    <section className="conversion-box no-print" style={{ marginTop: 16 }}>
      <div className="form-title-row">
        <div>
          <strong>{title}</strong>
          {description && <p className="small">{description}</p>}
        </div>
        <span className="auto-badge">ON DEMAND</span>
      </div>
      <div className="button-row" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setOpen(true)}>{buttonLabel}</button>
      </div>
    </section>
  );
}
