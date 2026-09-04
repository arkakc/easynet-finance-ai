"use client";

import { useEffect, useState } from "react";

export default function ApprovalsPage() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/approvals", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval queue load failed");
      setQuotes(body.quotes || []);
      setPos(body.purchaseOrders || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  async function decide(recordType: "quote" | "purchaseOrder", recordId: string, decision: "APPROVE" | "CANCEL") {
    try {
      const response = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, payload: { recordType, recordId, decision, note: "Finance Controller UI" } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval failed");
      setMessage(`${recordId}: ${body.previousStatus} → ${body.status}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed");
    }
  }

  const draftQuotes = quotes.filter((row) => String(row.status).toUpperCase() === "DRAFT");
  const draftPOs = pos.filter((row) => String(row.status).toUpperCase() === "DRAFT");

  return (
    <>
      <h2>Commercial Approvals</h2>
      <p className="small">Finance Controller approval for quotations and purchase orders before downstream conversion or fulfillment.</p>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <section className="panel table-wrap">
        <h3>Draft Quotations</h3>
        <table className="data-table"><thead><tr><th>Quotation</th><th>Customer</th><th>Project</th><th>Date</th><th>Total</th><th>Action</th></tr></thead><tbody>
          {draftQuotes.map((row) => <tr key={row.quoteId}><td>{row.quoteNumber}<br/><span className="small">{row.quoteId}</span></td><td>{row.customerId}</td><td>{row.projectId || "—"}</td><td>{row.quoteDate}</td><td>K{Number(row.totalAmount || 0).toFixed(2)}</td><td><div className="button-row"><button onClick={() => decide("quote", row.quoteId, "APPROVE")}>Approve</button><button className="secondary" onClick={() => decide("quote", row.quoteId, "CANCEL")}>Cancel</button></div></td></tr>)}
          {!draftQuotes.length && <tr><td colSpan={6}>No draft quotations.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Draft Purchase Orders</h3>
        <table className="data-table"><thead><tr><th>PO</th><th>Supplier</th><th>Project</th><th>Date</th><th>Total</th><th>Action</th></tr></thead><tbody>
          {draftPOs.map((row) => <tr key={row.poId}><td>{row.poNumber}<br/><span className="small">{row.poId}</span></td><td>{row.supplierId}</td><td>{row.projectId || "—"}</td><td>{row.poDate}</td><td>K{Number(row.totalAmount || 0).toFixed(2)}</td><td><div className="button-row"><button onClick={() => decide("purchaseOrder", row.poId, "APPROVE")}>Approve</button><button className="secondary" onClick={() => decide("purchaseOrder", row.poId, "CANCEL")}>Cancel</button></div></td></tr>)}
          {!draftPOs.length && <tr><td colSpan={6}>No draft purchase orders.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
