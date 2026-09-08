"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Context = "po" | "invoice" | "payment";
type Props = {
  context: Context;
  poId: string;
  supplierId: string;
  poTotal?: number;
  billId?: string;
  billNumber?: string;
  billTotal?: number;
  billOutstanding?: number;
  paymentId?: string;
};

type Payment = {
  paymentId: string;
  paymentNumber?: string;
  paymentType?: string;
  partyType?: string;
  partyId?: string;
  amount?: number | string;
  status?: string;
  journalId?: string;
  againstDocumentId?: string;
  reference?: string;
  createdAt?: string;
};

type SupplierBill = {
  billId: string;
  billNumber?: string;
  poId?: string;
  sourceDocumentId?: string;
  totalAmount?: number | string;
  outstandingAmount?: number | string;
  status?: string;
};

type PurchaseOrder = {
  poId: string;
  poNumber?: string;
  totalAmount?: number | string;
  status?: string;
};

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const createdValue = (row: Payment) => {
  const time = new Date(row.createdAt || "").getTime();
  return Number.isFinite(time) ? time : 0;
};

export default function SupplierAdvanceChainSummary(props: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const marker = `PO:${props.poId}|`;

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/erp/transactions", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "Supplier advance chain load failed");
        if (!active) return;
        const linkedPayments = (body.payments || []).filter((row: Payment) =>
          String(row.partyType || "") === "Supplier" &&
          String(row.paymentType || "").toUpperCase() === "PAY" &&
          String(row.partyId || "") === props.supplierId &&
          String(row.reference || "").startsWith(marker) &&
          !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase())
        );
        setPayments(linkedPayments);
        setBills((body.supplierBills || []).filter((row: SupplierBill) => String(row.poId || row.sourceDocumentId || "") === props.poId));
        setPo((body.purchaseOrders || []).find((row: PurchaseOrder) => String(row.poId || "") === props.poId) || null);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Supplier advance chain load failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [props.poId, props.supplierId]);

  const posted = useMemo(() => payments.filter((row) => String(row.status || "").toUpperCase() === "POSTED" && Boolean(row.journalId)), [payments]);
  const advanceCreated = useMemo(() => payments.reduce((sum, row) => sum + Number(row.amount || 0), 0), [payments]);
  const advancePosted = useMemo(() => posted.reduce((sum, row) => sum + Number(row.amount || 0), 0), [posted]);
  const advanceAllocated = useMemo(() => posted.filter((row) => Boolean(String(row.againstDocumentId || "").trim())).reduce((sum, row) => sum + Number(row.amount || 0), 0), [posted]);
  const advanceAvailable = Math.max(0, advancePosted - advanceAllocated);
  const poTotal = Number(props.poTotal ?? po?.totalAmount ?? 0);
  const poRemainingAfterAdvance = Math.max(0, poTotal - advancePosted);
  const thisInvoiceAdvance = props.billId
    ? posted.filter((row) => String(row.againstDocumentId || "") === props.billId).reduce((sum, row) => sum + Number(row.amount || 0), 0)
    : 0;
  const currentPayment = props.paymentId ? payments.find((row) => row.paymentId === props.paymentId) || null : null;
  const currentBillId = String(currentPayment?.againstDocumentId || props.billId || "");
  const currentBill = currentBillId ? bills.find((row) => String(row.billId || "") === currentBillId) || null : null;

  if (!loading && payments.length === 0) return null;

  return <section className="panel no-print" style={{ marginTop: 20 }}>
    <div className="form-title-row">
      <div>
        <h3>Supplier Advance Payment Status</h3>
        <p className="small">This summary follows the same supplier advance through Purchase Order → Supplier Invoice → Payment Entry / Adjustment, so users can see what has already been paid and what remains.</p>
      </div>
      <span className="auto-badge">{loading ? "Loading…" : `PO Advance ${money(advancePosted)}`}</span>
    </div>

    {message && <div className="status-banner" style={{ marginTop: 12 }}>{message}</div>}

    {!loading && <>
      <div className="document-meta" style={{ marginTop: 14 }}>
        <div><span>Purchase Order</span><strong><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(props.poId)}`}>{po?.poNumber || props.poId}</Link></strong></div>
        <div><span>PO Total</span><strong>{money(poTotal)}</strong></div>
        <div><span>Advance Created</span><strong>{money(advanceCreated)}</strong></div>
        <div><span>Advance Finalized / Paid</span><strong>{money(advancePosted)}</strong></div>
        <div><span>Advance Adjusted to Invoice(s)</span><strong>{money(advanceAllocated)}</strong></div>
        <div><span>Unallocated Advance Remaining</span><strong>{money(advanceAvailable)}</strong></div>
        <div><span>PO Value Remaining After Paid Advance</span><strong>{money(poRemainingAfterAdvance)}</strong></div>
        {props.billId && <div><span>Advance Adjusted to This Invoice</span><strong>{money(thisInvoiceAdvance)}</strong></div>}
        {props.billId && <div><span>This Invoice Outstanding</span><strong>{money(props.billOutstanding ?? currentBill?.outstandingAmount ?? 0)}</strong></div>}
        {props.paymentId && currentPayment && <div><span>This Advance Payment</span><strong>{money(currentPayment.amount)}</strong></div>}
        {props.paymentId && currentBill && <div><span>Allocated Supplier Invoice</span><strong><Link prefetch={false} href={`/transactions/supplierBill/${encodeURIComponent(currentBill.billId)}`}>{currentBill.billNumber || currentBill.billId}</Link></strong></div>}
        {props.paymentId && currentBill && <div><span>Invoice Remaining</span><strong>{money(currentBill.outstandingAmount ?? currentBill.totalAmount ?? 0)}</strong></div>}
      </div>

      <div className="button-row" style={{ marginTop: 14 }}>
        <Link prefetch={false} className="button-link secondary-link" href={`/transactions/purchaseOrder/${encodeURIComponent(props.poId)}`}>Back to Purchase Order</Link>
        {props.billId && <Link prefetch={false} className="button-link secondary-link" href={`/transactions/supplierBill/${encodeURIComponent(props.billId)}`}>Open Supplier Invoice</Link>}
      </div>

      {payments.length > 0 && <div className="table-wrap" style={{ marginTop: 18 }}>
        <table className="data-table">
          <thead><tr><th>Advance Payment</th><th>Created</th><th>Amount</th><th>Status</th><th>Adjusted Against</th></tr></thead>
          <tbody>{[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map((row) => {
            const allocatedBill = bills.find((bill) => String(bill.billId || "") === String(row.againstDocumentId || ""));
            return <tr key={row.paymentId}>
              <td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber || row.paymentId}</strong></Link></td>
              <td>{row.createdAt ? new Date(row.createdAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" }) : "—"}</td>
              <td>{money(row.amount)}</td>
              <td>{row.status || "DRAFT"}</td>
              <td>{allocatedBill ? <Link prefetch={false} href={`/transactions/supplierBill/${encodeURIComponent(allocatedBill.billId)}`}>{allocatedBill.billNumber || allocatedBill.billId}</Link> : row.againstDocumentId ? row.againstDocumentId : "Unallocated"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </>}
  </section>;
}
