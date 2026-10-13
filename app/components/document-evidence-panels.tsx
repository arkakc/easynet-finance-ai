"use client";

import { useEffect, useState } from "react";

type Evidence = {
  attachments: Array<{ id: string; code: string; name: string; status: string; mimeType: string | null; createdAt: string }>;
  events: Array<{ id: string; action: string; description: string | null; outcome: string; actorEmail: string | null; createdAt: string }>;
};

export default function DocumentEvidencePanels({ type, id }: { type: string; id: string }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    fetch(`/api/erp/document-evidence?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Evidence unavailable");
      setData({ attachments: body.attachments || [], events: body.events || [] });
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Evidence unavailable"); });
    return () => controller.abort();
  }, [type, id]);
  return <>
    <section id="document-attachments" className="panel" aria-label="Document attachments">
      <h2>Attachments</h2>
      {error ? <p className="small" role="status">{error}</p> : !data ? <p className="small">Loading attachment records…</p> :
        data.attachments.length ? <ul>{data.attachments.map(file => <li key={file.id}>
          <strong>{file.name}</strong> <span className="small">({file.code}, {file.status})</span>
        </li>)}</ul> : <p className="small">No linked attachment records found.</p>}
      <p className="small">Metadata only. Attachment viewing and upload remain governed by the existing Documents module.</p>
    </section>
    <section id="document-activity" className="panel" aria-label="Document audit activity">
      <h2>Activity & Audit</h2>
      {error ? <p className="small" role="status">{error}</p> : !data ? <p className="small">Loading recorded events…</p> :
        data.events.length ? <ol>{data.events.map(event => <li key={event.id}>
          <strong>{event.action}</strong> · <time>{new Date(event.createdAt).toLocaleString("en-PG")}</time>
          {event.actorEmail && <> · {event.actorEmail}</>}
          {event.description && <div className="small">{event.description}</div>}
          <span className="small">{event.outcome}</span>
        </li>)}</ol> : <p className="small">No recorded audit events matched this document.</p>}
      <p className="small">Shows matched AuditLog events, not a guarantee of complete historical coverage.</p>
    </section>
  </>;
}
