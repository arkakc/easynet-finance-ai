"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function today() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

type InvoicePaymentContext = {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  projectId: string;
  totalAmount: number;
  outstandingAmount: number;
};

type ReceiptInfo = {
  hasStock: boolean;
  ordered: number;
  received: number;
  remaining: number;
  hasRemaining: boolean;
  fullyReceived: boolean;
};

type ExistingItemCandidate = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: "STOCK" | "SERVICE" | "NON_STOCK";
  uom: string;
  movingAverageCost: number;
};

type TemporaryQuoteLine = {
  quoteLineId: string;
  lineNo: number;
  itemName: string;
  qty: number;
  uom: string;
  existingCandidates: ExistingItemCandidate[];
};

type StockReadinessLine = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: "STOCK" | "SERVICE" | "NON_STOCK";
  uom: string;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
  movingAverageCost: number;
  outOfStock: boolean;
  insufficientStock: boolean;
};

type QuoteReadiness = {
  quote: {
    quoteId: string;
    quoteNumber: string;
    customerId: string;
    projectId: string;
    status: string;
  };
  temporaryLines: TemporaryQuoteLine[];
  stockLines: StockReadinessLine[];
  needsProcurement: boolean;
  readyToConvert: boolean;
  existingInvoice: { invoiceId: string; invoiceNumber: string; status: string } | null;
};

type TempChoice = {
  itemId: string;
  itemType: "STOCK" | "SERVICE" | "NON_STOCK";
  uom: string;
};

function approvedPoLifecycle(status: string) {
  return ["APPROVED", "PART_RECEIVED", "RECEIVED", "PART_BILLED", "CONVERTED", "BILL_CREATED", "BILLED"].includes(status);
}

function paymentEligible(status: string) {
  return ["POSTED", "PARTLY_PAID"].includes(status);
}

function itemTypeLabel(value: string) {
  if (value === "NON_STOCK") return "Non-Stock";
  if (value === "SERVICE") return "Service";
  return "Stock";
}

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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentContext, setPaymentContext] = useState<InvoicePaymentContext | null>(null);
  const [receiptInfo, setReceiptInfo] = useState<ReceiptInfo | null>(null);
  const [receiptChecking, setReceiptChecking] = useState(false);
  const [quoteReadiness, setQuoteReadiness] = useState<QuoteReadiness | null>(null);
  const [quoteChecking, setQuoteChecking] = useState(false);
  const [tempChoices, setTempChoices] = useState<Record<string, TempChoice>>({});

  const normalizedStatus = status.toUpperCase();
  const isSupplierQuote = type === "purchaseOrder" && String(documentNumber || "").startsWith("SUPQ-");
  const canQuote = type === "quote" && ["APPROVED", "CONVERTED"].includes(normalizedStatus);
  const canSupplierQuote = isSupplierQuote && ["APPROVED", "CONVERTED"].includes(normalizedStatus);
  const canPo = type === "purchaseOrder" && !isSupplierQuote && approvedPoLifecycle(normalizedStatus);
  const canInvoicePayment = type === "invoice" && paymentEligible(normalizedStatus);
  const canSupplierInvoicePayment = type === "supplierBill" && paymentEligible(normalizedStatus);

  useEffect(() => {
    if (!canPo) return;
    let active = true;
    void (async () => {
      setReceiptChecking(true);
      try {
        const r = await fetch("/api/stock", { cache: "no-store" });
        const b = await r.json();
        if (!r.ok || !b.ok) throw new Error(b.error || "Unable to check Purchase Receipt balance");
        if (!active) return;
        const itemMap = new Map((b.items || []).map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
        const poLines = (b.poLines || []).filter((line: any) => String(line.poId || "") === id);
        const movements = b.movements || [];
        let ordered = 0;
        let received = 0;
        let hasStock = false;
        for (const line of poLines) {
          const item: any = itemMap.get(String(line.itemId || ""));
          if (String(item?.itemType || "").toUpperCase() !== "STOCK") continue;
          hasStock = true;
          const itemId = String(line.itemId || "");
          ordered += Number(line.qty || 0);
          received += movements
            .filter((movement: any) => String(movement.sourceDocumentId || "") === id
              && String(movement.itemId || "") === itemId
              && String(movement.movementType || "") === "PURCHASE_RECEIPT")
            .reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
        }
        const remaining = Math.max(0, ordered - received);
        setReceiptInfo({
          hasStock,
          ordered,
          received,
          remaining,
          hasRemaining: hasStock && remaining > 0.0001,
          fullyReceived: hasStock && ordered > 0.0001 && remaining <= 0.0001,
        });
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Unable to check Purchase Receipt balance");
      } finally {
        if (active) setReceiptChecking(false);
      }
    })();
    return () => { active = false; };
  }, [canPo, id]);

  useEffect(() => {
    if (!canQuote) return;
    let active = true;
    void (async () => {
      setQuoteChecking(true);
      try {
        const response = await fetch(`/api/erp/sales-quote-readiness?quoteId=${encodeURIComponent(id)}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "Unable to check quotation items and stock");
        if (!active) return;
        const readiness = body.readiness as QuoteReadiness;
        setQuoteReadiness(readiness);
        const nextChoices: Record<string, TempChoice> = {};
        for (const line of readiness.temporaryLines || []) {
          const candidate = line.existingCandidates?.length === 1 ? line.existingCandidates[0] : null;
          nextChoices[line.quoteLineId] = {
            itemId: candidate?.itemId || "",
            itemType: candidate?.itemType || "STOCK",
            uom: candidate?.uom || line.uom || "Each",
          };
        }
        setTempChoices(nextChoices);
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Unable to check quotation items and stock");
      } finally {
        if (active) setQuoteChecking(false);
      }
    })();
    return () => { active = false; };
  }, [canQuote, id]);

  if (!canQuote && !canSupplierQuote && !canPo && !canInvoicePayment && !canSupplierInvoicePayment) return null;

  function openPurchaseReceipt() {
    if (receiptChecking || !receiptInfo?.hasRemaining) return;
    router.push(`/stock?mode=movement&sourcePo=${encodeURIComponent(id)}`);
  }

  function patchTempChoice(lineId: string, patch: Partial<TempChoice>) {
    setTempChoices((current) => ({
      ...current,
      [lineId]: {
        itemId: current[lineId]?.itemId || "",
        itemType: current[lineId]?.itemType || "STOCK",
        uom: current[lineId]?.uom || "Each",
        ...patch,
      },
    }));
  }

  async function finalizeTemporaryItems() {
    if (!quoteReadiness?.temporaryLines.length || busy) return;
    for (const line of quoteReadiness.temporaryLines) {
      if (line.existingCandidates.length > 0 && !tempChoices[line.quoteLineId]?.itemId) {
        setMessage(`Line ${line.lineNo}: select the existing Item Master record before continuing.`);
        return;
      }
    }

    setBusy(true);
    setMessage("Creating / linking quotation items permanently in Item Master…");
    try {
      const response = await fetch("/api/erp/sales-quote-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: id, temporaryItems: tempChoices }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to finalize quotation items");
      setQuoteReadiness(body.readiness as QuoteReadiness);
      setTempChoices({});
      setMessage(
        `${Number(body.createdItems || 0)} new Item Master record(s) created and ${Number(body.linkedLines || 0)} quotation line(s) permanently linked. Stock readiness refreshed.`,
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to finalize quotation items");
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    setMessage(
      canSupplierQuote ? "Saving Purchase Order…"
        : canQuote ? "Saving Sales Invoice…"
          : canPo ? "Saving Supplier Invoice…"
            : "Preparing Payment Entry…",
    );
    try {
      if (canSupplierInvoicePayment) {
        router.push(`/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${encodeURIComponent(id)}`);
        return;
      }
      if (canInvoicePayment) {
        const r = await fetch(`/api/erp/invoice-payment-context?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const b = await r.json();
        if (!r.ok || !b.ok) throw new Error(b.error || "Unable to prepare payment entry");
        setPaymentContext(b.invoice);
        setMessage("");
        return;
      }
      if (canSupplierQuote) {
        const r = await fetch("/api/erp/purchase-conversions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierQuoteId: id }),
        });
        const b = await r.json();
        if (!r.ok || !b.ok) throw new Error(b.error || "Conversion failed");
        router.push(`/transactions/purchaseOrder/${b.createdId}`);
        router.refresh();
        return;
      }
      if (canQuote) {
        if (quoteReadiness?.existingInvoice?.invoiceId) {
          router.push(`/transactions/invoice/${encodeURIComponent(quoteReadiness.existingInvoice.invoiceId)}`);
          return;
        }
        if (!quoteReadiness?.readyToConvert) {
          throw new Error("Resolve temporary items and stock shortages before creating the Sales Invoice.");
        }
      }

      const action = canQuote ? "quoteToInvoice" : "poToBill";
      const payload = canQuote
        ? { quoteId: id, invoiceDate: today(), dueDate: "", revenueAccountId: "ACC-4100", updateStock: true }
        : { poId: id, billDate: today(), dueDate: "", costAccountId: "ACC-5100" };
      const r = await fetch("/api/erp/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error || "Conversion failed");
      router.push(`/transactions/${canQuote ? "invoice" : "supplierBill"}/${b.createdId}`);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setBusy(false);
    }
  }

  async function createPaymentDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!paymentContext || busy) return;
    setBusy(true);
    setMessage("Saving Payment Draft…");
    try {
      const f = new FormData(e.currentTarget);
      const amount = Number(f.get("amount") || 0);
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      if (amount > paymentContext.outstandingAmount + 0.001) throw new Error("Payment amount cannot exceed invoice outstanding amount");
      const r = await fetch("/api/erp/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPayment",
          payload: {
            paymentNumber: "",
            paymentType: "RECEIVE",
            partyType: "Customer",
            partyId: paymentContext.customerId,
            projectId: paymentContext.projectId || "",
            paymentDate: f.get("paymentDate"),
            amount,
            paymentMethod: f.get("paymentMethod"),
            cashBankAccountId: f.get("cashBankAccountId"),
            reference: f.get("reference") || "",
            againstDocumentType: "Sales Invoice",
            againstDocumentId: paymentContext.invoiceId,
          },
        }),
      });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error || "Payment draft creation failed");
      router.push(`/transactions/payment/${b.result.recordId}`);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Payment draft creation failed");
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = canSupplierInvoicePayment
    ? "Create Payment Entry / Receipt"
    : canInvoicePayment
      ? "Create Payment Entry / Receipt"
      : canQuote
        ? "Create Sales Invoice"
        : canSupplierQuote
          ? "Create Purchase Order"
          : "Create Supplier Invoice";

  const receiptButtonLabel = receiptChecking
    ? "Checking Receipt Qty…"
    : receiptInfo?.fullyReceived
      ? "Purchase Receipt Complete"
      : receiptInfo && !receiptInfo.hasStock
        ? "No Stock Items to Receive"
        : "Create Purchase Receipt / Goods Receipt";

  return (
    <div className="conversion-box no-print">
      <strong>Next Document</strong>
      <p className="small">Mapped actions keep source-document, Item Master, party, project and accounting linkage.</p>

      {canQuote && (
        <div style={{ marginTop: 12 }}>
          <strong>Sales Quotation → Sales Invoice Readiness</strong>
          <p className="small">
            Temporary quotation items must be permanently linked first. Stock items are checked against current balance and moving-average cost before an Update Stock Sales Invoice can be created.
          </p>

          {quoteChecking && <p className="small">Checking Item Master and current stock…</p>}

          {!quoteChecking && quoteReadiness?.existingInvoice && (
            <div style={{ marginTop: 12 }}>
              <p className="small">
                This quotation already has Sales Invoice <strong>{quoteReadiness.existingInvoice.invoiceNumber}</strong> ({quoteReadiness.existingInvoice.status}).
              </p>
              <button type="button" disabled={busy} onClick={() => void convert()}>
                {busy ? "Opening…" : "Open Existing Sales Invoice"}
              </button>
            </div>
          )}

          {!quoteChecking && quoteReadiness && !quoteReadiness.existingInvoice && quoteReadiness.temporaryLines.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <strong>Temporary Items — Finalize Before Conversion</strong>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Quotation Item</th>
                      <th>Qty</th>
                      <th>Item Master Action</th>
                      <th>Item Type</th>
                      <th>UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteReadiness.temporaryLines.map((line) => {
                      const choice = tempChoices[line.quoteLineId] || { itemId: "", itemType: "STOCK", uom: line.uom || "Each" };
                      const hasExisting = line.existingCandidates.length > 0;
                      const selectedCandidate = line.existingCandidates.find((candidate) => candidate.itemId === choice.itemId);
                      return (
                        <tr key={line.quoteLineId}>
                          <td>{line.lineNo}</td>
                          <td><strong>{line.itemName}</strong></td>
                          <td>{line.qty}</td>
                          <td>
                            {hasExisting ? (
                              <select
                                value={choice.itemId}
                                onChange={(event) => {
                                  const candidate = line.existingCandidates.find((item) => item.itemId === event.target.value);
                                  patchTempChoice(line.quoteLineId, {
                                    itemId: event.target.value,
                                    itemType: candidate?.itemType || choice.itemType,
                                    uom: candidate?.uom || choice.uom,
                                  });
                                }}
                                disabled={busy}
                                required
                              >
                                {line.existingCandidates.length > 1 && <option value="">Select existing Item Master</option>}
                                {line.existingCandidates.map((candidate) => (
                                  <option key={candidate.itemId} value={candidate.itemId}>
                                    {candidate.itemCode} — {candidate.itemName}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <strong>Create New Item Master</strong>
                            )}
                          </td>
                          <td>
                            {hasExisting ? (
                              <span>{itemTypeLabel(selectedCandidate?.itemType || choice.itemType)}</span>
                            ) : (
                              <select
                                value={choice.itemType}
                                onChange={(event) => patchTempChoice(line.quoteLineId, { itemType: event.target.value as TempChoice["itemType"] })}
                                disabled={busy}
                              >
                                <option value="STOCK">Stock Item</option>
                                <option value="SERVICE">Service Item</option>
                                <option value="NON_STOCK">Non-Stock Item</option>
                              </select>
                            )}
                          </td>
                          <td>
                            <input
                              value={choice.uom}
                              onChange={(event) => patchTempChoice(line.quoteLineId, { uom: event.target.value })}
                              readOnly={hasExisting}
                              disabled={busy}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="button-row" style={{ marginTop: 10 }}>
                <button type="button" disabled={busy} onClick={() => void finalizeTemporaryItems()}>
                  {busy ? "Saving…" : "Create / Link Items Permanently in Item Master"}
                </button>
              </div>
            </div>
          )}

          {!quoteChecking && quoteReadiness && !quoteReadiness.existingInvoice && quoteReadiness.temporaryLines.length === 0 && (
            <div style={{ marginTop: 14 }}>
              <strong>Current Stock & Moving Average Check</strong>
              {quoteReadiness.stockLines.length > 0 ? (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Type</th>
                        <th>Required Qty</th>
                        <th>Stock Balance</th>
                        <th>Moving Avg Cost</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteReadiness.stockLines.map((line) => (
                        <tr key={line.itemId}>
                          <td>
                            <Link prefetch={false} href={`/stock/item/${encodeURIComponent(line.itemId)}`}>
                              <strong>{line.itemCode}</strong>
                            </Link>
                            <br />
                            <span className="small">{line.itemName}</span>
                          </td>
                          <td>{itemTypeLabel(line.itemType)}</td>
                          <td>{line.itemType === "STOCK" ? `${line.requiredQty} ${line.uom}` : "—"}</td>
                          <td>{line.itemType === "STOCK" ? `${line.availableQty} ${line.uom}` : "Not stock controlled"}</td>
                          <td>K{Number(line.movingAverageCost || 0).toFixed(2)}</td>
                          <td>
                            {line.itemType !== "STOCK" ? "No stock check"
                              : line.outOfStock ? <strong>OUT OF STOCK</strong>
                                : line.insufficientStock ? <strong>SHORT BY {line.shortageQty}</strong>
                                  : <strong>AVAILABLE</strong>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small">No stock-controlled items on this quotation.</p>
              )}

              {quoteReadiness.needsProcurement ? (
                <div style={{ marginTop: 12 }}>
                  <p className="small">
                    <strong>Procurement required.</strong> One or more Stock Items do not have enough quantity for the quotation. Create and approve a Purchase Order, then receive the goods through Purchase Receipt / Goods Receipt. Sales Invoice conversion stays blocked until stock is available.
                  </p>
                  <div className="button-row">
                    <Link
                      prefetch={false}
                      className="button-link"
                      href={`/transactions?module=purchase&tab=purchaseOrder&mode=create&sourceSalesQuote=${encodeURIComponent(id)}`}
                    >
                      Create Purchase Order
                    </Link>
                    <Link prefetch={false} className="button-link secondary-link" href="/stock?mode=movement">
                      Purchase Receipt / Goods Receipt
                    </Link>
                    <button type="button" className="secondary" disabled={busy} onClick={() => window.location.reload()}>
                      Recheck Stock
                    </button>
                  </div>
                </div>
              ) : (
                <div className="button-row" style={{ marginTop: 12 }}>
                  <button type="button" disabled={busy || !quoteReadiness.readyToConvert} onClick={() => void convert()}>
                    {busy ? "Saving…" : "Create Sales Invoice"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!paymentContext && canPo && (
        <>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={busy || receiptChecking || !receiptInfo?.hasRemaining}
              onClick={openPurchaseReceipt}
            >
              {receiptButtonLabel}
            </button>
            <button type="button" disabled={busy} onClick={() => void convert()}>
              {busy ? "Saving…" : "Create Supplier Invoice"}
            </button>
          </div>
          {receiptInfo?.hasStock && (
            <p className="small">
              PO Qty {receiptInfo.ordered.toLocaleString()} · Received {receiptInfo.received.toLocaleString()} · Remaining {receiptInfo.remaining.toLocaleString()}
            </p>
          )}
        </>
      )}

      {!paymentContext && !canPo && !canQuote && (
        <button type="button" disabled={busy} onClick={() => void convert()}>
          {busy ? "Saving…" : buttonLabel}
        </button>
      )}

      {paymentContext && (
        <form onSubmit={createPaymentDraft} className="form-grid" style={{ marginTop: 16 }}>
          <label>Sales Invoice<input value={paymentContext.invoiceNumber || paymentContext.invoiceId} readOnly /></label>
          <label>Customer<input value={paymentContext.customerId} readOnly /></label>
          <label>Outstanding<input value={`K${Number(paymentContext.outstandingAmount || 0).toFixed(2)}`} readOnly /></label>
          <label>Payment Date<input name="paymentDate" type="date" defaultValue={today()} required disabled={busy} /></label>
          <label>Amount<input name="amount" type="number" min="0.01" max={paymentContext.outstandingAmount} step="0.01" defaultValue={paymentContext.outstandingAmount} required disabled={busy} /></label>
          <label>
            Payment Method
            <select name="paymentMethod" defaultValue="" required disabled={busy}>
              <option value="">Select payment method</option>
              <option>Cash</option>
              <option>Bank Transfer</option>
              <option>Card</option>
              <option>Cheque</option>
            </select>
          </label>
          <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="e.g. ACC-1120" required disabled={busy} /></label>
          <label>Reference<input name="reference" placeholder="Bank / receipt reference" disabled={busy} /></label>
          <div className="form-wide button-row">
            <button type="button" className="secondary" disabled={busy} onClick={() => setPaymentContext(null)}>Cancel</button>
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Payment Draft"}</button>
          </div>
        </form>
      )}

      {message && <span className="small" style={{ display: "block", marginTop: 10 }}>{message}</span>}
    </div>
  );
}
