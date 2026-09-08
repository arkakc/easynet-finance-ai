"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ApprovalRecordType = "quote" | "invoice" | "purchaseOrder" | "supplierBill" | "payment" | "expense";
type PendingRow = {
  module: "Sales" | "Purchase";
  documentType: string;
  documentNo: string;
  recordId: string;
  status: "DRAFT";
  party: string;
  project: string;
  date: string;
  createdAt?: string;
  amount: number | string;
  href: string;
  approvalRecordType: ApprovalRecordType;
};

function createdLabel(row: PendingRow) {
  const value = row.createdAt || row.date || "";
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-PG", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/approvals", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval queue load failed");
      setPending((body.pending || []).filter((row: PendingRow) => String(row.status).toUpperCase() === "DRAFT"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function decide(row: PendingRow, decision: "APPROVE" | "CANCEL") {
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "approvals", body: { payload: { recordType: row.approvalRecordType, recordId: row.recordId, decision, note: "Finance Controller UI" } } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval failed");
      setMessage(`${row.documentNo}: ${body.previousStatus} → ${body.status}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed");
    }
  }

  const sales = pending.filter((row) => row.module === "Sales");
  const purchase = pending.filter((row) => row.module === "Purchase");
  const table = (title: string, rows: PendingRow[]) => <section className="panel table-wrap"><div className="form-title-row"><h3>{title}</h3><span className="auto-badge">Newest created first</span></div><table className="data-table"><thead><tr><th>Document</th><th>Type</th><th>Party</th><th>Project</th><th>Created</th><th>Document Date</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.documentType}-${row.recordId}`}><td><Link href={row.href}><strong>{row.documentNo}</strong></Link></td><td>{row.documentType}</td><td>{row.party || "—"}</td><td>{row.project || "—"}</td><td>{createdLabel(row)}</td><td>{row.date || "—"}</td><td>K{Number(row.amount || 0).toFixed(2)}</td><td><strong>DRAFT</strong></td><td><div className="button-row"><Link className="button-link secondary-link" href={row.href}>Open Document</Link><button type="button" onClick={() => decide(row, "APPROVE")}>Approve</button><button type="button" className="secondary" onClick={() => decide(row, "CANCEL")}>Cancel</button></div></td></tr>)}{!rows.length && <tr><td colSpan={9}>No DRAFT documents pending approval.</td></tr>}</tbody></table></section>;

  return <><h2>Pending Approval Queue</h2><p className="small">Workflow: DRAFT → APPROVED → POSTED. Only DRAFT documents are listed here for approval; newest-created documents appear first.</p>{message && <section className="panel"><strong>Status:</strong> {message}</section>}{loading ? <section className="panel">Loading pending approvals…</section> : <>{table(`Sales — Pending (${sales.length})`, sales)}{table(`Purchase — Pending (${purchase.length})`, purchase)}</>}</>;
}
