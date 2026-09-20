"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Check = { key: string; label: string; blocking: boolean; passed: boolean; detail: string };
type Readiness = { ok: boolean; ready?: boolean; generatedAt?: string; error?: string; openingSubledgerLocked?: boolean; checks?: Check[]; snapshot?: { asOf: string; fingerprint: string; migrationReady: boolean } };

export default function GoLivePage() {
  const [data, setData] = useState<Readiness | null>(null);
  const load = useCallback(async () => { const response = await fetch("/api/system/go-live-readiness", { cache: "no-store" }); const body = await response.json(); setData(body); }, []);
  useEffect(() => { void load(); }, [load]);
  const checks = data?.checks || [];
  return <div className="page-stack">
    <section className="page-header"><div><span className="badge">Release control</span><h1>Go-Live Readiness Centre</h1><p>One release gate for finance controls, data integrity, backups and migration readiness.</p></div><span className={`coa-status-pill ${data?.ready ? "valid" : "invalid"}`}>{data ? (data.ready ? "READY" : "BLOCKED") : "CHECKING"}</span></section>
    {data?.error && <section className="warning-panel"><strong>Readiness check unavailable</strong><p className="small">{data.error}</p></section>}
    <section className="panel"><div className="form-title-row"><div><h2>Release decision</h2><p className="small">A blocking check must pass before production cutover. Warnings remain visible for review.</p></div><span className="auto-badge">{checks.filter((check) => check.passed).length}/{checks.length} passed</span></div><div className="table-wrap" style={{ marginTop: 16 }}><table className="data-table"><thead><tr><th>Control</th><th>Type</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{!checks.length && <tr><td colSpan={4}>Loading readiness controls…</td></tr>}{checks.map((check) => <tr key={check.key}><td><strong>{check.label}</strong></td><td>{check.blocking ? "BLOCKING" : "WARNING"}</td><td><span className={`coa-status-pill ${check.passed ? "valid" : "invalid"}`}>{check.passed ? "PASS" : "REVIEW"}</span></td><td>{check.detail}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><h2>Required next actions</h2><p className="small">Use the relevant control centre to resolve any failed gate, then refresh this page.</p><div className="button-row">{data?.openingSubledgerLocked ? <span className="secondary-btn disabled-link" title="Disabled because setup was activated as a new business with zero opening balances.">AR/AP opening import</span> : <Link className="secondary-btn" href="/migration/opening-subledger">AR/AP opening import</Link>}<Link className="secondary-btn" href="/payroll">Payroll reconciliation</Link><Link className="secondary-btn" href="/system/backups">Backups & snapshots</Link><Link className="secondary-btn" href="/controls">Finance controls</Link></div>{data?.snapshot && <p className="small" style={{ marginTop: 16 }}>Snapshot as of {data.snapshot.asOf}; fingerprint {data.snapshot.fingerprint.slice(0, 16)}…</p>}</section>
  </div>;
}
