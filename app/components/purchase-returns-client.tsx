"use client";

import { useCallback, useEffect, useState } from "react";
import { executeAction } from "@/lib/ui/action-contract";

type Receipt = { id: string; code: string; date: string; supplier: string; orderCode: string; items: Array<{ itemId: string; qty: number }> };
type ReturnRow = { id: string; code: string; receiptId: string; status: string; reason: string; lines: Array<{ itemId: string; qty: number }>; createdAt: string };
type Data = { ok: boolean; error?: string; returns: ReturnRow[]; receipts: Receipt[] };
export default function PurchaseReturnsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiptId, setReceiptId] = useState("");
  const [reason, setReason] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/erp/purchase-return", { cache: "no-store" });
    const result = await response.json() as Data;
    if (!response.ok || !result.ok) throw new Error(result.error || "Cannot load Purchase Returns");
    setData(result);
  }, []);
  useEffect(() => { void refresh().catch(reason => setError(String(reason))); }, [refresh]);
  const create = async () => {
    if (!receiptId || !itemId.trim() || !reason.trim() || !(Number(quantity) > 0)) { setError("Select posted GRN, provide Item ID, positive quantity and return reason."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await executeAction<{ ok: boolean; error?: string; message?: string }>("/api/erp/purchase-return", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", receiptId, reason, lines: [{ itemId: itemId.trim(), qty: Number(quantity) }] }),
      }, "Create Purchase Return");
      await refresh();
      setReason(""); setItemId(""); setQuantity("1");
      setMessage(result.message || "Draft saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Create failed"); }
    finally { setBusy(false); }
  };
  const action = async (id: string, type: "approve" | "cancel") => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await executeAction<{ ok: boolean; error?: string; message?: string }>("/api/erp/purchase-return", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: type, returnId: id }),
      }, type === "approve" ? "Approve Purchase Return" : "Cancel Purchase Return");
      await refresh();
      setMessage(result.message || (type === "approve" ? "Approved" : "Cancelled"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed"); }
    finally { setBusy(false); }
  };
  return <main className="page-stack">
    <header className="page-header"><div><p className="small">SUPPLIER JOURNEY / RETURNS</p><h1>Purchase Returns</h1><p>Create controlled stock return requests against posted GRNs.</p></div></header>
    {error && <section className="warning-panel" role="alert">{error}</section>}
    {message && <section className="panel" role="status">{message}</section>}
    <section className="panel">
      <h2>New Purchase Return Request</h2>
      <p className="small">Draft/approval UAT workflow only. Supplier Debit Note, reverse GST and inventory accounting posting are not active. No stock is moved by this form.</p>
      <div className="form-grid">
        <label>Posted Goods Receipt (GRN)<select value={receiptId} onChange={event => { setReceiptId(event.target.value); setItemId(""); }}><option value="">Select posted GRN</option>{(data?.receipts || []).map(receipt => <option key={receipt.id} value={receipt.id}>{receipt.code} · {receipt.supplier} · {receipt.orderCode}</option>)}</select></label>
        <label>Received item<select value={itemId} onChange={event => setItemId(event.target.value)}><option value="">Select received item</option>{(data?.receipts.find(row => row.id === receiptId)?.items || []).map(line => <option key={line.itemId} value={line.itemId}>{line.itemId} — received {line.qty}</option>)}</select></label>
        <label>Return quantity<input type="number" min="0.0001" step="any" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Reason<input value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain the returned goods" /></label>
      </div>
      <div className="button-row"><button type="button" disabled={busy} onClick={() => void create()}>{busy ? "Processing…" : "Create Draft Purchase Return"}</button></div>
    </section>
    <section className="panel">
      <h2>Purchase Returns Register</h2>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Return</th><th>GRN</th><th>Status</th><th>Reason</th><th>Item lines</th><th>Actions</th></tr></thead><tbody>
        {(data?.returns || []).map(row => <tr key={row.id}><td>{row.code}</td><td>{data?.receipts.find(receipt => receipt.id === row.receiptId)?.code || row.receiptId}</td><td>{row.status}</td><td>{row.reason}</td><td>{row.lines.map(line => `${line.itemId}: ${line.qty}`).join(", ")}</td><td>{row.status === "DRAFT" ? <div className="button-row"><button type="button" disabled={busy} onClick={() => void action(row.id, "approve")}>Approve Request</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => void action(row.id, "cancel")}>Cancel</button></div> : "—"}</td></tr>)}
        {!data?.returns.length && <tr><td colSpan={6}>No purchase return requests yet.</td></tr>}
      </tbody></table></div>
    </section>
  </main>;
}
