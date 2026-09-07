"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: "STOCK" | "SERVICE" | "NON_STOCK";
  uom: string;
  revenueAccount: string;
  costAccount: string;
  deferredRevenueMonths: number;
};

type TempLine = {
  poLineId: string;
  lineNo: number;
  originalTempItemName: string;
  itemName: string;
  qty: number;
  uom: string;
  rate: number;
  existingCandidates: Candidate[];
};

type Readiness = {
  supplierQuoteId: string;
  supplierQuoteNumber: string;
  status: string;
  temporaryLines: TempLine[];
  allItemsPermanent: boolean;
  existingPo: { poId: string; poNumber: string; status: string } | null;
};

type Draft = {
  existingItemId: string;
  itemName: string;
  itemType: "STOCK" | "SERVICE" | "NON_STOCK";
  uom: string;
  revenueAccount: string;
  costAccount: string;
  deferredRevenueMonths: string;
};

function defaultDraft(line: TempLine): Draft {
  const only = line.existingCandidates.length === 1 ? line.existingCandidates[0] : null;
  return {
    existingItemId: only?.itemId || "",
    itemName: only?.itemName || line.itemName || line.originalTempItemName,
    itemType: only?.itemType || "STOCK",
    uom: only?.uom || line.uom || "Each",
    revenueAccount: only?.revenueAccount || "ACC-4200",
    costAccount: only?.costAccount || "ACC-5100",
    deferredRevenueMonths: String(only?.deferredRevenueMonths || 0),
  };
}

export default function SupplierQuoteItemReadiness({ supplierQuoteId }: { supplierQuoteId: string }) {
  const router = useRouter();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/erp/supplier-quote-readiness?supplierQuoteId=${encodeURIComponent(supplierQuoteId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Quotation readiness load failed");
      const next = body.readiness as Readiness;
      setReadiness(next);
      setDrafts(Object.fromEntries((next.temporaryLines || []).map((line) => [line.poLineId, defaultDraft(line)])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier Quotation readiness load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [supplierQuoteId]);

  const allPermanent = Boolean(readiness?.allItemsPermanent);
  const converted = Boolean(readiness?.existingPo);
  const approved = String(readiness?.status || "").toUpperCase() === "APPROVED";
  const canMaterialize = approved && !converted && !allPermanent;
  const canConvert = approved && !converted && allPermanent;

  function patch(lineId: string, next: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [lineId]: { ...current[lineId], ...next } }));
  }

  function selectExisting(line: TempLine, itemId: string) {
    const candidate = line.existingCandidates.find((item) => item.itemId === itemId);
    if (!candidate) {
      patch(line.poLineId, { existingItemId: "" });
      return;
    }
    patch(line.poLineId, {
      existingItemId: candidate.itemId,
      itemName: candidate.itemName,
      itemType: candidate.itemType,
      uom: candidate.uom,
      revenueAccount: candidate.revenueAccount || (candidate.itemType === "SERVICE" ? "ACC-4100" : "ACC-4200"),
      costAccount: candidate.costAccount || (candidate.itemType === "SERVICE" ? "ACC-5200" : "ACC-5100"),
      deferredRevenueMonths: String(candidate.deferredRevenueMonths || 0),
    });
  }

  async function savePermanentItems() {
    if (!readiness || busy || !canMaterialize) return;
    setBusy(true);
    setMessage("Saving permanent Item Master records and linking Supplier Quotation lines…");
    try {
      const resolutions = readiness.temporaryLines.map((line) => ({
        poLineId: line.poLineId,
        existingItemId: drafts[line.poLineId]?.existingItemId || "",
        itemName: drafts[line.poLineId]?.itemName || line.itemName,
        itemType: drafts[line.poLineId]?.itemType || "STOCK",
        uom: drafts[line.poLineId]?.uom || line.uom || "Each",
        revenueAccount: drafts[line.poLineId]?.revenueAccount || "",
        costAccount: drafts[line.poLineId]?.costAccount || "",
        deferredRevenueMonths: Number(drafts[line.poLineId]?.deferredRevenueMonths || 0),
      }));
      const response = await fetch("/api/erp/supplier-quote-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierQuoteId, resolutions }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to save Supplier Quotation items permanently");
      setReadiness(body.readiness as Readiness);
      setDrafts({});
      setMessage(`${body.createdItems || 0} Item Master record(s) created; ${body.linkedLines || 0} Supplier Quotation line(s) permanently linked.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save Supplier Quotation items permanently");
    } finally {
      setBusy(false);
    }
  }

  async function convertToPo() {
    if (!canConvert || busy) return;
    setBusy(true);
    setMessage("Saving Purchase Order…");
    try {
      const response = await fetch("/api/erp/purchase-conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierQuoteId }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Quotation conversion failed");
      router.push(`/transactions/purchaseOrder/${encodeURIComponent(body.createdId)}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier Quotation conversion failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="conversion-box no-print"><strong>Supplier Quotation → Purchase Order</strong><p className="small">Checking permanent Item Master links…</p></section>;
  if (!readiness) return message ? <section className="panel status-banner no-print">{message}</section> : null;

  return <section className="conversion-box no-print">
    <div className="form-title-row">
      <div>
        <strong>Supplier Quotation → Purchase Order Readiness</strong>
        <p className="small">Every TEMP supplier line must be converted into a permanent Item Master record before a Purchase Order can be created.</p>
      </div>
      <span className="auto-badge">{converted ? "CONVERTED" : allPermanent ? "ITEMS READY" : `${readiness.temporaryLines.length} TEMP ITEM(S)`}</span>
    </div>

    {message && <div className="status-banner" style={{ marginTop: 12 }}>{message}</div>}

    {converted && readiness.existingPo && <div style={{ marginTop: 14 }}>
      <p>This Supplier Quotation is already converted to <strong>{readiness.existingPo.poNumber}</strong> ({readiness.existingPo.status}).</p>
      <Link className="button-link" prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(readiness.existingPo.poId)}`}>Open Purchase Order</Link>
    </div>}

    {!converted && readiness.temporaryLines.length > 0 && <div className="table-wrap" style={{ marginTop: 14 }}>
      <table className="data-table" style={{ minWidth: 1350 }}>
        <thead><tr><th>Line</th><th>Original TEMP Item</th><th>Qty</th><th>Existing Item</th><th>Permanent Item Name</th><th>Type</th><th>UOM</th><th>Revenue Account</th><th>Cost Account</th><th>Deferred Months</th></tr></thead>
        <tbody>{readiness.temporaryLines.map((line) => {
          const draft = drafts[line.poLineId] || defaultDraft(line);
          const existingSelected = Boolean(draft.existingItemId);
          return <tr key={line.poLineId}>
            <td>{line.lineNo}</td>
            <td><strong>{line.originalTempItemName}</strong><br/><span className="small">This original supplier wording remains on the Supplier Quotation for audit trail.</span></td>
            <td>{line.qty}</td>
            <td><select value={draft.existingItemId} onChange={(event) => selectExisting(line, event.target.value)} disabled={busy}>
              <option value="">Create New Item Master</option>
              {line.existingCandidates.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}
            </select></td>
            <td><input value={draft.itemName} onChange={(event) => patch(line.poLineId, { itemName: event.target.value })} readOnly={existingSelected} disabled={busy} /></td>
            <td><select value={draft.itemType} onChange={(event) => patch(line.poLineId, { itemType: event.target.value as Draft["itemType"] })} disabled={busy || existingSelected}><option value="STOCK">Stock Item</option><option value="SERVICE">Service Item</option><option value="NON_STOCK">Non-Stock Item</option></select></td>
            <td><input value={draft.uom} onChange={(event) => patch(line.poLineId, { uom: event.target.value })} readOnly={existingSelected} disabled={busy} /></td>
            <td><input value={draft.revenueAccount} onChange={(event) => patch(line.poLineId, { revenueAccount: event.target.value })} readOnly={existingSelected} disabled={busy} /></td>
            <td><input value={draft.costAccount} onChange={(event) => patch(line.poLineId, { costAccount: event.target.value })} readOnly={existingSelected} disabled={busy} /></td>
            <td><input type="number" min="0" max="120" value={draft.deferredRevenueMonths} onChange={(event) => patch(line.poLineId, { deferredRevenueMonths: event.target.value })} readOnly={existingSelected} disabled={busy} /></td>
          </tr>;
        })}</tbody>
      </table>
      <div className="button-row" style={{ marginTop: 12 }}><button type="button" onClick={() => void savePermanentItems()} disabled={busy || !canMaterialize}>{busy ? "Saving…" : "Save All TEMP Items Permanently in Item Master"}</button></div>
    </div>}

    {!converted && allPermanent && <div style={{ marginTop: 14 }}>
      <p><strong>All Supplier Quotation items are permanently linked to Item Master.</strong> The Purchase Order will use those same permanent Item IDs and names.</p>
      <button type="button" disabled={busy || !canConvert} onClick={() => void convertToPo()}>{busy ? "Saving…" : "Create Purchase Order"}</button>
    </div>}
  </section>;
}
