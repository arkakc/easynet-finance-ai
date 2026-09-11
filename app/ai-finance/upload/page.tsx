"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function UploadPage() {
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setResult("Reading, retaining, and extracting document with Google Gemini AI…");
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

  return (
    <>
      <div className="page-head">
        <div>
          <h2>AI Source Document Intake & OCR</h2>
          <p className="small">
            Multimodal OCR line extraction, SHA-256 fingerprinting, and audit evidence retention in Google Drive.
          </p>
        </div>
        <div className="page-head-actions">
          {result && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown" style={{ maxHeight: "300px", overflowY: "auto", maxWidth: "450px" }}>
                <strong>Extraction Result:</strong>
                <pre style={{ margin: "6px 0 0 0", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem" }}>
                  {result}
                </pre>
              </div>
            </details>
          )}
          <Link prefetch={false} className="button-link secondary-link" href="/documents">
            ← Document Register
          </Link>
          <span className="badge">AI Intake Gateway</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Supported Formats</div>
          <div className="value small-value">PDF, PNG, JPG, WEBP</div>
        </div>
        <div className="card">
          <div className="label">File Size Limit</div>
          <div className="value small-value">8 MB per document</div>
        </div>
        <div className="card">
          <div className="label">Duplicate Check</div>
          <div className="value small-value">SHA-256 Hash Guard</div>
        </div>
        <div className="card">
          <div className="label">Governance Role</div>
          <div className="value small-value">Extract & Propose Only</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={submit}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Upload Financial Source Document</h3>
          <span className="auto-badge">Intake Queue</span>
        </div>
        <label className="form-wide">
          Source Document File
          <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required disabled={running} />
          <span className="small">
            PDF invoices, supplier delivery dockets, sales orders or receipts. Duplicate files are rejected automatically.
          </span>
        </label>
        <div className="form-wide button-row">
          <button type="submit" disabled={running}>
            {running ? "Extracting with AI…" : "Retain & Extract Document"}
          </button>
        </div>
      </form>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>Intake Control & Safety Policy</h3>
          <span className="auto-badge">AI Safety</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Safety Dimension</th>
              <th>System Policy</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>AI Operational Scope</strong>
              </td>
              <td>Extracts line items, parties and totals. Never posts to General Ledger without manual approval.</td>
              <td><span className="auto-badge">Controlled</span></td>
            </tr>
            <tr>
              <td>
                <strong>Source Evidence Retention</strong>
              </td>
              <td>All original uploads are saved permanently to secure storage before processing.</td>
              <td><span className="auto-badge">Enforced</span></td>
            </tr>
            <tr>
              <td>
                <strong>Cryptographic Deduplication</strong>
              </td>
              <td>SHA-256 fingerprint checked prior to OCR to prevent duplicate bills or expenses.</td>
              <td><span className="auto-badge">Active</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
