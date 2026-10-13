"use client";

import { useEffect, useState } from "react";

type Evidence = {
  attachments: Array<{ id: string; code: string; name: string; status: string; mimeType: string | null; createdAt: string }>;
  events: Array<{ id: string; action: string; description: string | null; outcome: string; actorEmail: string | null; createdAt: string }>;
};

export default function DocumentEvidencePanels({ type, id }: { type: string; id: string }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
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
  }, [type, id, refresh]);
  async function upload() {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError("");
    try {
      const body = new FormData();
      body.set("type", type); body.set("id", id); body.set("file", file);
      const response = await fetch("/api/erp/document-evidence/file", { method: "POST", body });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Upload failed");
      setFile(null);
      setRefresh(n => n + 1);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "Upload failed"); }
    finally { setUploading(false); }
  }
  return <>
    <section id="document-attachments" className="panel" aria-label="Document attachments">
      <h2>Attachments</h2>
      {error ? <p className="small" role="status">{error}</p> : !data ? <p className="small">Loading attachment records…</p> :
        data.attachments.length ? <ul>{data.attachments.map(item => <li key={item.id}>
          <strong>{item.name}</strong> <span className="small">({item.code}, {item.status})</span>
          <span> · <a href={`/api/erp/document-evidence/file?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&attachmentId=${encodeURIComponent(item.id)}&preview=1`} target="_blank" rel="noopener noreferrer">Preview</a> · <a href={`/api/erp/document-evidence/file?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&attachmentId=${encodeURIComponent(item.id)}`}>Download</a></span>
        </li>)}</ul> : <p className="small">No linked attachment records found.</p>}
      <div className="button-row no-print" style={{ flexWrap: "wrap" }}><input aria-label="Choose evidence attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={event => setFile(event.target.files?.[0] || null)} /><button type="button" disabled={!file || uploading} onClick={() => void upload()}>{uploading ? "Uploading…" : "Upload Evidence"}</button></div>
      {uploadError && <p role="alert" className="small">{uploadError}</p>}
      <p className="small">PDF or image, maximum 10 MB. Private local storage is intended for local deployment; durable production storage requires separate configuration.</p>
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
