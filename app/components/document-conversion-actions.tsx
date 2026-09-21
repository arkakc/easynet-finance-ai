"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function today() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

type ReceiptInfo = {
  hasStock: boolean;
  ordered: number;
  received: number;
  remaining: number;
  hasRemaining: boolean;
  partial: boolean;
  fullyReceived: boolean;
};

const PO_LIFECYCLE = new Set([
  "APPROVED",
  "PART_RECEIVED",
  "RECEIVED",
  "PART_BILLED",
  "CONVERTED",
  "BILL_CREATED",
  "BILLED",
  "CLOSED_PARTIAL",
]);

export default function DocumentConversionActions({
  type,
  id,
  status,
  documentNumber,
}: {
  type: string;
  id: string;
  status: string;
  documentNumber?: string;
}) {
  const router = useRouter();
  const normalizedStatus = String(status || "").toUpperCase();
  const isSupplierQuotation = type === "purchaseOrder" && String(documentNumber || "").toUpperCase().startsWith("SUPQ-");
  const isPurchaseOrder = type === "purchaseOrder" && !isSupplierQuotation && PO_LIFECYCLE.has(normalizedStatus);
  const canSupplierPayment = type === "supplierBill" && ["POSTED", "PARTLY_PAID"].includes(normalizedStatus);
  const [receiptInfo, setReceiptInfo] = useState<ReceiptInfo | null>(null);
  const [existingSupplierBill, setExistingSupplierBill] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isPurchaseOrder) return;
    let active = true;
    void (async () => {
      setChecking(true);
      try {
        const [stockResponse, transactionResponse] = await Promise.all([
          fetch("/api/stock", { cache: "no-store" }),
          fetch("/api/erp/transactions", { cache: "no-store" }),
        ]);
        const body = await stockResponse.json();
        if (!stockResponse.ok || !body.ok) throw new Error(body.error || "Unable to check Purchase Receipt balance");
        const transactionBody = await transactionResponse.json();
        if (!active) return;

        const itemMap = new Map<string, any>((body.items || []).map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
        const orderedByItem = new Map<string, number>();
        for (const line of (body.poLines || []).filter((row: any) => String(row.poId || "") === id)) {
          const itemId = String(line.itemId || "");
          const item = itemMap.get(itemId);
          if (String(item?.itemType || "").toUpperCase() !== "STOCK") continue;
          orderedByItem.set(itemId, (orderedByItem.get(itemId) || 0) + Number(line.qty || 0));
        }

        const movements = Array.isArray(body.movements) ? body.movements : [];
        let ordered = 0;
        let received = 0;
        for (const [itemId, qty] of orderedByItem.entries()) {
          ordered += qty;
          received += movements
            .filter((movement: any) => String(movement.sourceDocumentId || "") === id
              && String(movement.itemId || "") === itemId
              && String(movement.movementType || "") === "PURCHASE_RECEIPT")
            .reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
        }

        const hasStock = orderedByItem.size > 0;
        const remaining = Math.max(0, ordered - received);
        setReceiptInfo({
          hasStock,
          ordered,
          received,
          remaining,
          hasRemaining: hasStock && remaining > 0.0001,
          partial: received > 0.0001 && remaining > 0.0001,
          fullyReceived: hasStock && ordered > 0.0001 && remaining <= 0.0001,
        });
        if (transactionResponse.ok && transactionBody.ok) {
          const refs = new Set([id, documentNumber].map((value) => String(value || "")).filter(Boolean));
          const linkedBill = (transactionBody.supplierBills || []).find((bill: any) => !["CANCELLED", "REVERSED"].includes(String(bill.status || "").toUpperCase())
            && [bill.poId, bill.orderId, bill.sourceDocumentId].some((value) => refs.has(String(value || ""))));
          setExistingSupplierBill(linkedBill || null);
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Unable to check Purchase Receipt balance");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => { active = false; };
  }, [documentNumber, id, isPurchaseOrder]);

  if (!isPurchaseOrder && !canSupplierPayment) return null;

  async function createSupplierInvoice() {
    if (!isPurchaseOrder || busy || normalizedStatus === "BILLED") return;
    setBusy(true);
    setMessage("Saving Supplier Invoice from currently billable Purchase Order quantity…");
    try {
      const response = await fetch("/api/erp/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "poToBill",
          payload: { poId: id, billDate: today(), dueDate: "", costAccountId: "ACC-5100" },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoice conversion failed");
      router.push(`/transactions/supplierBill/${encodeURIComponent(body.createdId)}?returnModule=purchase&returnTab=purchaseOrder&returnMode=list`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier Invoice conversion failed");
    } finally {
      setBusy(false);
    }
  }

  if (canSupplierPayment) {
    return <section className="conversion-box no-print">
      <strong>Next Document</strong>
      <p className="small">Create the next supplier payment against this posted Supplier Invoice. Partial payments remain available until the invoice is fully settled.</p>
      <div className="button-row" style={{ marginTop: 12 }}>
        <Link className="button-link" href={`/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${encodeURIComponent(id)}`}>
          Create Supplier Payment Entry
        </Link>
      </div>
    </section>;
  }

  const poClosed = normalizedStatus === "CLOSED_PARTIAL";
  const receiptButtonLabel = checking
    ? "Checking Receipt Qty…"
    : poClosed
      ? "PO Closed — No More Receipt"
      : receiptInfo?.fullyReceived
        ? "Purchase Receipt Complete"
        : receiptInfo && !receiptInfo.hasStock
          ? "No Stock Items to Receive"
          : "Create Purchase Receipt / GRN";

  return <section className="conversion-box no-print">
    <div className="form-title-row">
      <div>
        <strong>Purchase Order → Receipt / Supplier Invoice</strong>
        <p className="small">Receipt availability is calculated once per unique Item, so repeated PO lines for the same Item cannot double-count received quantity.</p>
      </div>
      <span className="auto-badge">{normalizedStatus}</span>
    </div>

    {receiptInfo?.hasStock && <div className="document-meta" style={{ marginTop: 12 }}>
      <div><span>Ordered Stock Qty</span><strong>{receiptInfo.ordered.toLocaleString()}</strong></div>
      <div><span>Received Qty</span><strong>{receiptInfo.received.toLocaleString()}</strong></div>
      <div><span>Remaining Qty</span><strong>{receiptInfo.remaining.toLocaleString()}</strong></div>
      <div><span>Receipt Status</span><strong>{receiptInfo.fullyReceived ? "FULLY RECEIVED" : receiptInfo.partial ? "PARTIAL RECEIPT" : "NOT RECEIVED"}</strong></div>
    </div>}

    <div className="button-row" style={{ marginTop: 12 }}>
      <button
        type="button"
        className="secondary"
        disabled={busy || checking || poClosed || !receiptInfo?.hasRemaining}
        onClick={() => router.push(`/stock?mode=movement&sourcePo=${encodeURIComponent(id)}`)}
      >
        {receiptButtonLabel}
      </button>
      {existingSupplierBill
        ? <span className="auto-badge">Supplier Invoice {["POSTED","PARTLY_PAID","PAID"].includes(String(existingSupplierBill.status || "").toUpperCase()) ? "Posted" : "Draft"}: {existingSupplierBill.billNumber || existingSupplierBill.billId}</span>
        : <button type="button" disabled={busy || normalizedStatus === "BILLED"} onClick={() => void createSupplierInvoice()}>
          {busy ? "Saving…" : normalizedStatus === "BILLED" ? "Supplier Invoice Complete" : "Create Supplier Invoice"}
        </button>}
    </div>

    {poClosed && <div className="status-banner" style={{ marginTop: 12 }}>
      Remaining supply was closed. No additional Purchase Receipt is allowed, but already received and not-yet-billed quantity can still be converted to a Supplier Invoice.
    </div>}
    {message && <div className="status-banner" style={{ marginTop: 12 }}>{message}</div>}
  </section>;
}
