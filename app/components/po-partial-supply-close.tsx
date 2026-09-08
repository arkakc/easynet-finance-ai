"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RemainingLine = {
  itemId: string;
  itemName: string;
  itemType: string;
  uom: string;
  orderedQty: number;
  fulfilledQty: number;
  remainingQty: number;
  rate: number;
  totalAmount: number;
};

type State = {
  status: string;
  fulfilledQty: number;
  remainingQty: number;
  hasPartialFulfillment: boolean;
  remainingLines: RemainingLine[];
  replacement: { poId: string; poNumber?: string; status?: string } | null;
  closure: { message?: string; resolution?: string; createdAt?: string } | null;
};

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const qty = (value: unknown) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function PoPartialSupplyClose({ poId, poNumber }: { poId: string; poNumber: string }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/erp/po-close-transfer?poId=${encodeURIComponent(poId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Partial supply status load failed");
      setState(body.state as State);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Partial supply status load failed");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [poId]);

  async function closeAndCreate() {
    if (!state?.hasPartialFulfillment || busy) return;
    if (remarks.trim().length < 5) { setMessage("Enter a closure remark explaining why the supplier cannot complete the remaining quantity."); return; }
    if (!window.confirm(`Close the remaining quantity on ${poNumber} and create a new DRAFT Purchase Order for only that balance?`)) return;
    setBusy("close");
    setMessage("Closing remaining quantity and creating replacement Purchase Order…");
    try {
      const response = await fetch("/api/erp/po-close-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId, remarks }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Purchase Order partial-supply close failed");
      setState(body.state as State);
      setMessage(`Purchase Order marked CLOSED_PARTIAL. Remaining quantity moved to ${body.state?.replacement?.poNumber || body.state?.replacement?.poId || "new draft PO"}. Review the new supplier/quantities before approval.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Purchase Order partial-supply close failed");
    } finally { setBusy(""); }
  }

  async function createSupplierInvoiceForDeliveredQty() {
    if (busy) return;
    setBusy("invoice");
    setMessage(`Creating Supplier Invoice from delivered quantity on ${poNumber}…`);
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby" }).format(new Date());
      const response = await fetch("/api/erp/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poToBill", payload: { poId, billDate: today, dueDate: "", costAccountId: "ACC-5100" } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoice creation failed");
      router.push(`/transactions/supplierBill/${encodeURIComponent(body.createdId)}?returnModule=purchase&returnTab=purchaseOrder&returnMode=list`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier Invoice creation failed");
    } finally { setBusy(""); }
  }

  if (loading) return null;
  if (!state) return message ? <section className="panel status-banner no-print" style={{ marginTop: 20 }}>{message}</section> : null;
  const closed = ["CLOSED", "CLOSED_PARTIAL"].includes(String(state.status || "").toUpperCase());
  if (!closed && !state.hasPartialFulfillment) return null;

  return <section className="panel no-print" style={{ marginTop: 20 }}>
    <div className="form-title-row">
      <div>
        <h3>{closed ? "Purchase Order Closed for Partial Supply" : "Supplier Cannot Complete Remaining PO Quantity"}</h3>
        <p className="small">Use this only when part of the PO has already been fulfilled and the supplier confirms the remaining quantity will not be supplied. The old PO becomes CLOSED_PARTIAL with an audit remark; a new DRAFT PO is created for only the unfulfilled balance.</p>
      </div>
      <span className="auto-badge">{closed ? "CLOSED_PARTIAL" : `Remaining Qty ${qty(state.remainingQty)}`}</span>
    </div>

    {message && <div className="status-banner" style={{ marginTop: 12 }}>{message}</div>}

    <div className="document-meta" style={{ marginTop: 14 }}>
      <div><span>Old Purchase Order</span><strong>{poNumber}</strong></div>
      <div><span>Fulfilled Quantity</span><strong>{qty(state.fulfilledQty)}</strong></div>
      <div><span>Quantity Not Supplied</span><strong>{qty(state.remainingQty)}</strong></div>
      {state.replacement && <div><span>Replacement Purchase Order</span><strong><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(state.replacement.poId)}`}>{state.replacement.poNumber || state.replacement.poId}</Link></strong></div>}
      {state.replacement && <div><span>Replacement Status</span><strong>{state.replacement.status || "DRAFT"}</strong></div>}
      {state.closure?.createdAt && <div><span>Closed At</span><strong>{new Date(state.closure.createdAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })}</strong></div>}
    </div>

    {state.remainingLines.length > 0 && <div className="table-wrap" style={{ marginTop: 18 }}>
      <table className="data-table">
        <thead><tr><th>Item</th><th>Type</th><th>Ordered</th><th>Fulfilled</th><th>Move to New PO</th><th>Rate</th><th>Value</th></tr></thead>
        <tbody>{state.remainingLines.map((line) => <tr key={line.itemId}><td><strong>{line.itemName}</strong><br/><span className="small">{line.itemId} · {line.uom}</span></td><td>{line.itemType}</td><td>{qty(line.orderedQty)}</td><td>{qty(line.fulfilledQty)}</td><td><strong>{qty(line.remainingQty)}</strong></td><td>{money(line.rate)}</td><td>{money(line.totalAmount)}</td></tr>)}</tbody>
      </table>
    </div>}

    {!closed && <div className="form-grid" style={{ marginTop: 18 }}>
      <label className="form-wide">Closure Remarks<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} maxLength={500} placeholder="Example: Supplier confirmed remaining 4 units are unavailable and cannot be supplied. Move remaining quantity to a new PO." disabled={Boolean(busy)} /></label>
      <div className="form-wide status-banner">The replacement PO is created as <strong>DRAFT</strong>. Review supplier, quantities and commercial terms before approval. Existing receipts, invoices and supplier advances remain linked to the old PO for audit/accounting history.</div>
      <div className="form-wide button-row"><button type="button" disabled={Boolean(busy) || remarks.trim().length < 5} onClick={() => void closeAndCreate()}>{busy === "close" ? "Closing & Creating…" : "Close Remaining Qty & Create Replacement PO"}</button></div>
    </div>}

    {closed && <>
      <div className="status-banner" style={{ marginTop: 16 }}><strong>Closure Remark:</strong> {state.closure?.message || "Closed after partial supply."}{state.closure?.resolution ? <><br/><strong>Resolution:</strong> {state.closure.resolution}</> : null}</div>
      <div className="button-row" style={{ marginTop: 16 }}>
        {state.replacement && <Link prefetch={false} className="button-link" href={`/transactions/purchaseOrder/${encodeURIComponent(state.replacement.poId)}`}>Open Remaining-Quantity PO</Link>}
        {state.fulfilledQty > 0.0001 && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void createSupplierInvoiceForDeliveredQty()}>{busy === "invoice" ? "Creating Supplier Invoice…" : "Create Supplier Invoice for Delivered Qty"}</button>}
      </div>
    </>}
  </section>;
}
