"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Entity = "ar" | "ap";
type EntryMode = "file" | "manual";
type Position = { openingJournalCode: string | null; recognitionDate: string | null; openingGlBalance: number; importedSubledger: number; remaining: number; supported: boolean; message: string };
type PreviewRow = { rowNumber: number; documentCode: string; partyCode: string; partyName: string | null; originalDocumentDate: string; dueDate: string; outstanding: number; description: string; action: "CREATE" | "INVALID"; errors: string[] };
type Preview = { ok: boolean; error?: string; fileName?: string; entity?: Entity; position?: Position; rows?: PreviewRow[]; summary?: { received: number; valid: number; invalid: number; scheduleTotal: number; targetTotal: number; difference: number; ready: boolean } };
type Status = { ok: boolean; locked?: boolean; lockReason?: string; error?: string; positions?: Record<Entity, Position>; history?: Array<{ id: string; entity: Entity; fileName: string; description: string; importedBy: string; createdAt: string; details?: { total?: number; backupFile?: string } }> };
type ManualRow = { documentCode: string; partyCode: string; originalDocumentDate: string; dueDate: string; outstanding: string; description: string };

const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK" }).format(value);
const emptyManualRow = (): ManualRow => ({ documentCode: "", partyCode: "", originalDocumentDate: "", dueDate: "", outstanding: "", description: "" });
const manualRowHasValue = (row: ManualRow) => Object.values(row).some((value) => value.trim());

export default function OpeningSubledgerPage() {
  const [entity, setEntity] = useState<Entity>("ar");
  const [entryMode, setEntryMode] = useState<EntryMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyManualRow()]);
  const [status, setStatus] = useState<Status | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/migration/opening-subledger", { cache: "no-store" });
      const body = await response.json();
      setStatus(body);
    } catch (error) {
      setStatus({ ok: false, error: error instanceof Error ? error.message : "Opening balance status failed" });
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const resetWorkingState = () => {
    setFile(null);
    setFileInputKey((current) => current + 1);
    setPreview(null);
    setConfirmation("");
  };

  const setManualValue = (index: number, field: keyof ManualRow, value: string) => {
    setManualRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setPreview(null);
    setConfirmation("");
  };

  const addManualRow = () => setManualRows((current) => [...current, emptyManualRow()]);
  const removeManualRow = (index: number) => {
    setManualRows((current) => current.length === 1 ? [emptyManualRow()] : current.filter((_, rowIndex) => rowIndex !== index));
    setPreview(null);
    setConfirmation("");
  };

  const send = async (mode: "preview" | "commit") => {
    const rows = manualRows.filter(manualRowHasValue);
    if (entryMode === "file" && !file) return setPreview({ ok: false, error: "Select an aged schedule first" });
    if (entryMode === "manual" && !rows.length) return setPreview({ ok: false, error: "Enter at least one manual opening schedule row" });
    setBusy(true);
    setMessage("");
    try {
      const response = entryMode === "file"
        ? await fetch("/api/migration/opening-subledger", { method: "POST", body: (() => {
          const form = new FormData();
          form.set("file", file!);
          form.set("entity", entity);
          form.set("mode", mode);
          if (mode === "commit") form.set("confirmation", confirmation);
          return form;
        })() })
        : await fetch("/api/migration/opening-subledger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity, mode, confirmation: mode === "commit" ? confirmation : "", fileName: `manual-${entity}-opening-schedule`, rows }),
        });
      const body = await response.json();
      if (!response.ok || !body.ok) return setPreview({ ...(preview || {}), ok: false, error: body.error || "Opening schedule request failed" });
      if (mode === "preview") setPreview(body);
      else {
        setMessage(`${body.message}. Verified backup: ${body.backupFile}`);
        setPreview(null);
        setFile(null);
        if (entryMode === "manual") setManualRows([emptyManualRow()]);
        setFileInputKey((current) => current + 1);
        setConfirmation("");
        await loadStatus();
      }
    } catch (error) {
      setPreview({ ...(preview || {}), ok: false, error: error instanceof Error ? error.message : "Opening schedule request failed" });
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send("preview"); };
  const position = status?.positions?.[entity];
  const phrase = preview?.summary ? `IMPORT OPENING ${entity.toUpperCase()} K${preview.summary.targetTotal.toFixed(2)}` : "";
  const locked = Boolean(status?.locked);
  const canPreview = Boolean(!locked && !busy && position?.supported && position.remaining > 0 && (entryMode === "file" ? file : manualRows.some(manualRowHasValue)));
  const partyLabel = entity === "ar" ? "Customer Code" : "Supplier Code";

  return (
    <div className={`page-stack ${locked ? "doctype-locked" : ""}`}>
      {locked && <section className="warning-panel doctype-lock-notice"><strong>Opening AR/AP Import disabled</strong><p className="small">{status?.lockReason || "This doctype is locked for the current setup."}</p></section>}
      <section className="page-header lockable-doctype">
        <div><span className="badge">Opening Balance Control</span><h1>Opening AR/AP Aged Schedule Import</h1><p>Allocate the posted opening control balances to customer and supplier documents without creating duplicate GL journals.</p></div>
      </section>

      {(status?.error || preview?.error || message) && <section className={status?.error || preview?.error ? "warning-panel" : "panel"}><strong>{status?.error || preview?.error ? "Action required" : "Import completed"}</strong><p className="small">{status?.error || preview?.error || message}</p></section>}

      <section className="panel lockable-doctype">
        <div className="form-title-row"><div><h2>1. Opening balance target</h2><p className="small">Select receivables or payables and download the matching CSV template.</p></div><span className="auto-badge">LOCAL DATABASE ONLY</span></div>
        <div className="button-row" style={{ marginTop: 16 }}>
          <button type="button" className={entity === "ar" ? "" : "secondary-btn"} disabled={locked} onClick={() => { setEntity("ar"); resetWorkingState(); }}>Accounts Receivable</button>
          <button type="button" className={entity === "ap" ? "" : "secondary-btn"} disabled={locked} onClick={() => { setEntity("ap"); resetWorkingState(); }}>Accounts Payable</button>
          {locked ? <span className="secondary-btn disabled-link">Download {entity.toUpperCase()} Template</span> : <a className="secondary-btn" href={`/api/migration/opening-subledger?template=${entity}`}>Download {entity.toUpperCase()} Template</a>}
        </div>
        <div className="document-meta" style={{ marginTop: 16 }}>
          <div><span>Opening journal</span><strong>{position?.openingJournalCode || "—"}</strong></div>
          <div><span>Recognition date</span><strong>{position?.recognitionDate || "—"}</strong></div>
          <div><span>Opening GL</span><strong>{position ? money(position.openingGlBalance) : "—"}</strong></div>
          <div><span>Already allocated</span><strong>{position ? money(position.importedSubledger) : "—"}</strong></div>
          <div><span>Remaining target</span><strong>{position ? money(position.remaining) : "—"}</strong></div>
        </div>
        {position && <p className="small" style={{ marginTop: 12 }}>{position.message}</p>}
      </section>

      <section className="panel lockable-doctype">
        <div className="form-title-row"><div><h2>2. Enter schedule and validate</h2><p className="small">Use CSV/XLSX import or manual entry. Dates may use YYYY-MM-DD or DD/MM/YYYY. The total must exactly match the remaining target.</p></div><span className="auto-badge">PREVIEW FIRST</span></div>
        <div className="button-row" style={{ marginTop: 16 }}>
          <button type="button" className={entryMode === "file" ? "" : "secondary-btn"} disabled={locked || busy} onClick={() => { setEntryMode("file"); resetWorkingState(); }}>Import CSV/XLSX</button>
          <button type="button" className={entryMode === "manual" ? "" : "secondary-btn"} disabled={locked || busy} onClick={() => { setEntryMode("manual"); resetWorkingState(); }}>Manual entry</button>
        </div>
        <form className="form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
          {entryMode === "file" ? (
            <label className="form-wide">{entity === "ar" ? "Customer aged receivables" : "Supplier aged payables"} schedule
              <input key={fileInputKey} type="file" accept=".csv,.xlsx,.xls" disabled={locked || busy || position?.remaining === 0} required onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setConfirmation(""); }} />
            </label>
          ) : (
            <div className="form-wide table-wrap">
              <div className="form-title-row"><div><strong>Manual {entity.toUpperCase()} opening schedule rows</strong><p className="small">Enter the same information as the template. Customer/Supplier code must already exist and be active.</p></div><button type="button" className="secondary-btn" disabled={locked || busy} onClick={addManualRow}>+ Add row</button></div>
              <table className="data-table" style={{ marginTop: 12 }}>
                <thead><tr><th>Document Code</th><th>{partyLabel}</th><th>Original Date</th><th>Due Date</th><th>Outstanding</th><th>Description</th><th>Action</th></tr></thead>
                <tbody>{manualRows.map((row, index) => (
                  <tr key={index}>
                    <td><input value={row.documentCode} onChange={(event) => setManualValue(index, "documentCode", event.target.value)} disabled={locked || busy} placeholder={entity === "ar" ? "OB-AR-001" : "OB-AP-001"} /></td>
                    <td><input value={row.partyCode} onChange={(event) => setManualValue(index, "partyCode", event.target.value)} disabled={locked || busy} placeholder={entity === "ar" ? "Customer code" : "Supplier code"} /></td>
                    <td><input value={row.originalDocumentDate} onChange={(event) => setManualValue(index, "originalDocumentDate", event.target.value)} disabled={locked || busy} placeholder="YYYY-MM-DD" /></td>
                    <td><input value={row.dueDate} onChange={(event) => setManualValue(index, "dueDate", event.target.value)} disabled={locked || busy} placeholder="YYYY-MM-DD" /></td>
                    <td><input type="number" min="0" step="0.01" value={row.outstanding} onChange={(event) => setManualValue(index, "outstanding", event.target.value)} disabled={locked || busy} placeholder="0.00" /></td>
                    <td><input value={row.description} onChange={(event) => setManualValue(index, "description", event.target.value)} disabled={locked || busy} placeholder="Opening balance note" /></td>
                    <td><button type="button" className="secondary-btn" disabled={locked || busy} onClick={() => removeManualRow(index)}>Remove</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="form-wide button-row"><button type="submit" disabled={!canPreview}>{busy ? "Validating…" : "Preview & Validate"}</button></div>
        </form>
      </section>

      {preview?.summary && (
        <section className="panel table-wrap lockable-doctype">
          <div className="form-title-row"><div><h2>3. Validation result</h2><p className="small">Every row and the aggregate control total must pass before import.</p></div><span className="auto-badge">{preview.summary.ready ? "READY" : "NOT READY"}</span></div>
          <div className="document-meta" style={{ marginTop: 16 }}>
            <div><span>Rows</span><strong>{preview.summary.received}</strong></div><div><span>Valid</span><strong>{preview.summary.valid}</strong></div><div><span>Invalid</span><strong>{preview.summary.invalid}</strong></div><div><span>Schedule total</span><strong>{money(preview.summary.scheduleTotal)}</strong></div><div><span>Difference</span><strong>{money(preview.summary.difference)}</strong></div>
          </div>
          <table className="data-table" style={{ marginTop: 16 }}>
            <thead><tr><th>Row</th><th>Document</th><th>Party</th><th>Original / due</th><th>Outstanding</th><th>Validation</th></tr></thead>
            <tbody>{preview.rows?.map((row) => <tr key={`${row.rowNumber}-${row.documentCode}`}><td>{row.rowNumber}</td><td><strong>{row.documentCode || "—"}</strong><div className="small">{row.description || "Opening balance"}</div></td><td>{row.partyName || "—"}<div className="small">{row.partyCode || "—"}</div></td><td>{row.originalDocumentDate || "—"}<div className="small">Due {row.dueDate || "—"}</div></td><td><strong>{money(row.outstanding)}</strong></td><td>{row.errors.join("; ") || "Valid"}</td></tr>)}</tbody>
          </table>
          {preview.summary.ready && <div className="conversion-box" style={{ marginTop: 16 }}><strong>Confirm controlled opening import</strong><p className="small">Type <strong>{phrase}</strong>. A verified backup will be created before the atomic import.</p><div className="button-row" style={{ marginTop: 12 }}><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={locked || busy} placeholder={phrase} style={{ maxWidth: 410 }} /><button type="button" disabled={locked || busy || confirmation !== phrase} onClick={() => void send("commit")}>{busy ? "Importing…" : `Backup & Import ${preview.summary.valid} rows`}</button></div></div>}
        </section>
      )}

      <section className="warning-panel lockable-doctype"><strong>Outstanding-only carry-forward</strong><p className="small">Imported document totals equal the remaining outstanding balances—not the original gross invoice values. Original dates remain in the audit notes; recognition is aligned to the posted opening journal so historical reports stay controlled.</p></section>

      <section className="panel table-wrap lockable-doctype">
        <div className="form-title-row"><div><h2>Import audit history</h2><p className="small">Completed batches retain file, amount, backup and user evidence.</p></div><span className="auto-badge">{status?.history?.length || 0} batches</span></div>
        <table className="data-table" style={{ marginTop: 16 }}><thead><tr><th>Date</th><th>Type</th><th>File</th><th>Total</th><th>Imported by</th></tr></thead><tbody>{!status?.history?.length && <tr><td colSpan={5}>No opening schedule has been imported.</td></tr>}{status?.history?.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })}</td><td>{row.entity.toUpperCase()}</td><td>{row.fileName}</td><td>{money(row.details?.total || 0)}</td><td>{row.importedBy}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
