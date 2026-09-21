"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Candidate = {
  id: string;
  kind: string;
  state: "READY" | "RECOVERED" | "MANUAL";
  eligible: boolean;
  confidence: number;
  journalCode: string;
  journalDate: string;
  reference: string | null;
  description: string;
  partyCode: string | null;
  partyName: string | null;
  linkedDocumentCode: string | null;
  total: number;
  subtotal: number;
  taxTotal: number;
  reasons: string[];
};

type RecoveryData = {
  ok: boolean;
  error?: string;
  message?: string;
  generatedAt?: string;
  candidates?: Candidate[];
  summary?: { ready: number; recovered: number; manual: number; recoverableValue: number; manualArOpening: number; manualApOpening: number };
  controls?: { receivables: { glBalance: number; subledgerBalance: number; difference: number }; payables: { glBalance: number; subledgerBalance: number; difference: number } };
  history?: Array<{ id: string; backupFile: string; description: string; recoveredBy: string; createdAt: string; details?: { created?: unknown[] } }>;
  backupFile?: string;
};

const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK" }).format(value);
const kindLabel: Record<string, string> = {
  SALES_INVOICE: "Sales invoice",
  SUPPLIER_BILL: "Supplier bill",
  CUSTOMER_RECEIPT: "Customer receipt",
  SUPPLIER_PAYMENT: "Supplier payment",
  OPENING_AR: "Opening AR",
  OPENING_AP: "Opening AP",
};

export default function SubledgerRecoveryPage() {
  const [data, setData] = useState<RecoveryData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/migration/subledger-recovery", { cache: "no-store" });
      const body = await response.json();
      setData(body);
      if (response.ok && body.ok) setSelected((body.candidates || []).filter((row: Candidate) => row.eligible).map((row: Candidate) => row.id));
    } catch (error) {
      setData({ ok: false, error: error instanceof Error ? error.message : "Recovery scan failed" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const phrase = `RECOVER ${selected.length} SUBLEDGER RECORDS`;
  const selectedValue = useMemo(() => (data?.candidates || []).filter((row) => selected.includes(row.id)).reduce((sum, row) => sum + row.total, 0), [data, selected]);

  const recover = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/migration/subledger-recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateIds: selected, confirmation }) });
      const body = await response.json();
      if (!response.ok || !body.ok) return setData((current) => ({ ...(current || { ok: false }), ok: false, error: body.error || "Recovery failed" }));
      setConfirmation("");
      await load();
      setData((current) => ({ ...(current || body), ok: true, message: `${body.message}. Backup: ${body.backupFile}` }));
    } catch (error) {
      setData((current) => ({ ...(current || { ok: false }), ok: false, error: error instanceof Error ? error.message : "Recovery failed" }));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="badge">Controlled Migration</span>
          <h1>AR/AP Legacy Subledger Recovery</h1>
          <p>Rebuild missing invoices, bills and their allocations from verified posted journals—without posting a second time to the general ledger.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}>{busy ? "Scanning…" : "Scan Again"}</button>
      </section>

      {(data?.error || data?.message) && <section className={data.error ? "warning-panel" : "panel"}><strong>{data.error ? "Action required" : "Recovery completed"}</strong><p className="small">{data.error || data.message}</p></section>}

      <section className="panel">
        <div className="form-title-row"><div><h2>Reconciliation position</h2><p className="small">Current posted GL compared with the document subledgers.</p></div><span className="auto-badge">READ-ONLY SCAN</span></div>
        <div className="document-meta" style={{ marginTop: 16 }}>
          <div><span>Ready candidates</span><strong>{data?.summary?.ready ?? "—"}</strong></div>
          <div><span>Manual items</span><strong>{data?.summary?.manual ?? "—"}</strong></div>
          <div><span>Recoverable activity</span><strong>{data?.summary ? money(data.summary.recoverableValue) : "—"}</strong></div>
          <div><span>AR difference</span><strong>{data?.controls ? money(data.controls.receivables.difference) : "—"}</strong></div>
          <div><span>AP difference</span><strong>{data?.controls ? money(data.controls.payables.difference) : "—"}</strong></div>
        </div>
      </section>

      <section className="panel table-wrap">
        <div className="form-title-row"><div><h2>Journal evidence</h2><p className="small">Only high-confidence rows can be selected. Recovered and manual rows remain visible for control evidence.</p></div><span className="auto-badge">{selected.length} selected</span></div>
        <table className="data-table" style={{ marginTop: 16 }}>
          <thead><tr><th>Select</th><th>Date / journal</th><th>Recovery</th><th>Party</th><th>Amount</th><th>Confidence</th><th>Evidence</th></tr></thead>
          <tbody>
            {!data?.candidates?.length && <tr><td colSpan={7}>{busy ? "Scanning posted journals…" : "No AR/AP recovery evidence found."}</td></tr>}
            {data?.candidates?.map((row) => (
              <tr key={row.id}>
                <td><input aria-label={`Select ${row.journalCode}`} type="checkbox" checked={selected.includes(row.id)} disabled={!row.eligible || busy} onChange={() => toggle(row.id)} /></td>
                <td><strong>{row.journalCode}</strong><div className="small">{row.journalDate}</div></td>
                <td>{kindLabel[row.kind] || row.kind}<div className="small">{row.linkedDocumentCode || row.state}</div></td>
                <td>{row.partyName || "Manual allocation required"}<div className="small">{row.partyCode || "—"}</div></td>
                <td><strong>{money(row.total)}</strong>{row.taxTotal > 0 && <div className="small">GST {money(row.taxTotal)}</div>}</td>
                <td><span className="status-pill">{row.state} · {row.confidence}%</span></td>
                <td>{row.reasons.map((reason) => <div className="small" key={reason}>{reason}</div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="form-title-row"><div><h2>Apply selected recovery</h2><p className="small">A verified local backup is created first. The selected rows are then revalidated and written atomically with an audit trail.</p></div><span className="auto-badge">NO NEW GL JOURNALS</span></div>
        <div className="conversion-box" style={{ marginTop: 16 }}>
          <strong>{selected.length} record(s) · {money(selectedValue)}</strong>
          <p className="small">Type <strong>{phrase}</strong> exactly. If you select a payment, keep its related invoice or bill selected unless that document already exists.</p>
          <div className="button-row" style={{ marginTop: 12 }}>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy || !selected.length} placeholder={phrase} style={{ maxWidth: 390 }} />
            <button type="button" onClick={() => void recover()} disabled={busy || !selected.length || confirmation !== phrase}>{busy ? "Working…" : "Backup & Recover"}</button>
          </div>
        </div>
      </section>

      <section className="warning-panel">
        <strong>Opening balances remain a manual migration item</strong>
        <p className="small">The GL contains {money(data?.summary?.manualArOpening || 0)} opening AR and {money(data?.summary?.manualApOpening || 0)} opening AP without customer/supplier allocation. Import dated aged schedules before those balances are reconstructed.</p>
      </section>

      <section className="panel table-wrap">
        <div className="form-title-row"><div><h2>Recovery audit history</h2><p className="small">Each completed batch records its verified backup and recovered entity IDs.</p></div><span className="auto-badge">{data?.history?.length || 0} batches</span></div>
        <table className="data-table" style={{ marginTop: 16 }}>
          <thead><tr><th>Date</th><th>Backup</th><th>Result</th><th>Recovered by</th></tr></thead>
          <tbody>
            {!data?.history?.length && <tr><td colSpan={4}>No subledger recovery batch has been applied.</td></tr>}
            {data?.history?.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })}</td><td>{row.backupFile}</td><td>{row.description}</td><td>{row.recoveredBy}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}
