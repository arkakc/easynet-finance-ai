"use client";

import { FormEvent, useState } from "react";

export default function UploadPage() {
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setResult("Reading, retaining and extracting document...");

    try {
      const formData = new FormData(event.currentTarget);
      formData.set("secret", secret);
      const res = await fetch("/api/documents/extract", { method: "POST", body: formData });
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

  return (
    <>
      <h2>AI Source Document Intake</h2>
      <p className="small">
        PDF/JPG/PNG/WEBP documents are fingerprinted for duplicates, retained in Google Drive, extracted into structured finance fields, and saved to the review queue. AI never posts accounting entries automatically.
      </p>

      <section className="panel">
        <label>APP_SECRET
          <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" required />
        </label>
      </section>

      <form className="panel" onSubmit={submit}>
        <label>Source document</label>
        <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required />
        <p className="small">MVP limit: 8 MB. Duplicate files are blocked by SHA-256 before extraction.</p>
        <button type="submit" disabled={running}>{running ? "Extracting..." : "Retain & Extract Document"}</button>
      </form>

      {result && <pre className="panel status-pre">{result}</pre>}

      <section className="panel">
        <h3>Control Policy</h3>
        <p>AI role: <strong>extract and propose only</strong></p>
        <p>Source evidence: <strong>retained in Google Drive</strong></p>
        <p>Duplicate control: <strong>SHA-256 fingerprint</strong></p>
        <p>Posting: <strong>blocked until human review</strong></p>
      </section>
    </>
  );
}
