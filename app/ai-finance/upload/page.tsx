"use client";

import { FormEvent, useState } from "react";

export default function UploadPage() {
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setResult("Reading, retaining and extracting document...");
    try {
      const formData = new FormData(event.currentTarget);
      const res = await fetch("/api/erp/documents/extract", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "Extraction failed");
      setResult(JSON.stringify(body, null, 2));
      event.currentTarget.reset();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Extraction failed");
    } finally {
      setRunning(false);
    }
  }

  return <>
    <h2>AI Source Document Intake</h2>
    <p className="small">PDF/JPG/PNG/WEBP documents are retained, fingerprinted and extracted into the review queue. Your signed-in user permission authorizes this action.</p>
    <form className="panel" onSubmit={submit}>
      <label>Source document</label>
      <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required />
      <p className="small">MVP limit: 8 MB. Duplicate files are blocked by SHA-256 before extraction.</p>
      <button type="submit" disabled={running}>{running ? "Extracting..." : "Retain & Extract Document"}</button>
    </form>
    {result && <pre className="panel status-pre">{result}</pre>}
    <section className="panel"><h3>Control Policy</h3><p>AI role: <strong>extract and propose only</strong></p><p>Source evidence: <strong>retained in Google Drive</strong></p><p>Duplicate control: <strong>SHA-256 fingerprint</strong></p><p>Posting: <strong>blocked until human review</strong></p></section>
  </>;
}
