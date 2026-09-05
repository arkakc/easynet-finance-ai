"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

export default function SupplierInvoicePanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/erp/transactions", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoices load failed");
      setRows(Array.isArray(body.supplierBills) ? body.supplierBills : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier Invoices load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function approve(recordId: string) {
    setMessage("Approving Supplier Invoice…");
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "approvals", body: { payload: { recordType: "supplierBill", recordId, decision: "APPROVE", note: "Supplier Invoice list" } } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval failed");
      setMessage("Supplier Invoice approved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed");
    }
  }

  return <>
    {message && <section className="panel status-banner">{message}</section>}
    <section className="panel">
      <div className="form-title-row">
        <div>
          <h3>Supplier Invoices</h3>
          <p className="small">Purchase Orders converted to Supplier Invoice appear here. Approve the Supplier Invoice before creating a Purchase Payment Entry.</p>
        </div>
        <span className="auto-badge">{loading ? "Loading…" : `${rows.length} Documents`}</span>
      </div>
    </section>
    <section className="panel table-wrap">
      <table className="data-table">
        <thead><tr><th>Supplier Invoice</th><th>Supplier / Project</th><th>Total</th><th>Paid / Outstanding</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {!loading && rows.length === 0 && <tr><td colSpan={6}>No Supplier Invoices found. Convert an approved Purchase Order to create one.</td></tr>}
          {rows.map((row) => {
            const status = String(row.status || "DRAFT").toUpperCase();
            return <tr key={row.billId}>
              <td><Link href={`/transactions/supplierBill/${row.billId}`}><strong>{row.billNumber || row.billId}</strong></Link></td>
              <td>{row.supplierId || "—"}<br /><span className="small">{row.projectId || "No project"}</span></td>
              <td><strong>{money(row.totalAmount)}</strong></td>
              <td>{money(row.paidAmount)}<br /><span className="small">Outstanding {money(row.outstandingAmount ?? row.totalAmount)}</span></td>
              <td>{status}</td>
              <td><div className="row-actions"><Link className="button-link secondary-link" href={`/transactions/supplierBill/${row.billId}`}>View / Print</Link>{status === "DRAFT" && <button type="button" onClick={() => void approve(row.billId)}>Approve</button>}</div></td>
            </tr>;
          })}
        </tbody>
      </table>
    </section>
  </>;
}
