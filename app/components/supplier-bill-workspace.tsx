"use client";

import Link from "next/link";
import { useState } from "react";
import SupplierAdvanceChainSummary from "@/app/components/supplier-advance-chain-summary";
import SupplierInvoiceAdvanceAdjustment from "@/app/components/supplier-invoice-advance-adjustment";
import DocumentConversionActions from "@/app/components/document-conversion-actions";
import LinkedDocumentReference from "@/app/components/linked-document-reference";

type Tab = "settlement" | "related" | "accounting";
type Props = {
  billId: string;
  billNumber: string;
  status: string;
  supplierId: string;
  poId: string;
  total: number;
  outstanding: number;
  paid: number;
  journalId?: string;
  links: Array<{ type?: string; id?: string; number?: string; href?: string; stage?: number }>;
  onPlanChange?: (value: { plannedTotal: number; projectedOutstanding: number }) => void;
};

const money = (amount: number) => `K${Number(amount || 0).toFixed(2)}`;

export default function SupplierBillWorkspace(props: Props) {
  const [tab, setTab] = useState<Tab>("settlement");
  const status = String(props.status || "").toUpperCase();
  const posted = ["POSTED", "PARTLY_PAID", "PARTIAL", "PAID", "SETTLED"].includes(status);
  const canSettle = posted && props.outstanding > 0.001;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "settlement", label: "Settlement & Advances" },
    { id: "related", label: "Related Documents" },
    { id: "accounting", label: "Accounting & Audit" },
  ];

  return <section id="supplier-bill-workspace" className="panel no-print" style={{ marginTop: 16, scrollMarginTop: 20 }}>
    <div className="form-title-row">
      <div>
        <span className="document-section-kicker">Purchases / Supplier Bills</span>
        <h2 style={{ margin: "4px 0" }}>Supplier Invoice Workspace</h2>
        <p className="small">Manage advances, related purchase documents and accounting from this invoice. No separate settlement page needed.</p>
      </div>
      <span className="auto-badge">{status || "DRAFT"}</span>
    </div>
    <div className="document-meta" style={{ marginTop: 12 }}>
      <div><span>Invoice Total</span><strong>{money(props.total)}</strong></div>
      <div><span>Settled / Paid</span><strong>{money(props.paid)}</strong></div>
      <div><span>Outstanding</span><strong>{money(props.outstanding)}</strong></div>
    </div>
    <div role="tablist" aria-label="Supplier Invoice workspace" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0" }}>
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
        className={tab === item.id ? "" : "secondary"} onClick={() => setTab(item.id)}>
        {item.label}
      </button>)}
    </div>
    {tab === "settlement" && <div role="tabpanel">
      {!posted && <p className="small">Invoice settlement starts after approval and posting. DRAFT invoices can plan PO-linked advances for automatic allocation during approval.</p>}
      {!props.poId && <div className="status-banner">No source Purchase Order linked. PO-specific advance matching cannot be suggested automatically.</div>}
      {props.poId && posted && <SupplierAdvanceChainSummary context="invoice" poId={props.poId}
        supplierId={props.supplierId} billId={props.billId} billNumber={props.billNumber}
        billTotal={props.total} billOutstanding={props.outstanding} />}
      {props.poId && <SupplierInvoiceAdvanceAdjustment billId={props.billId}
        billNumber={props.billNumber} poId={props.poId} supplierId={props.supplierId}
        outstandingAmount={props.outstanding} status={status} onPlanChange={props.onPlanChange} />}
      {canSettle && <div style={{ marginTop: 14 }}>
        <h3>Next action</h3>
        <p className="small">Review any available advance above before creating a new bank payment. The payment action uses the existing approval and posting flow.</p>
        <DocumentConversionActions type="supplierBill" id={props.billId} status={status} documentNumber={props.billNumber} />
      </div>}
      {!canSettle && posted && <p className="small">Invoice has no outstanding balance. See related documents for settlement history.</p>}
    </div>}
    {tab === "related" && <div role="tabpanel">
      <h3>Purchase document chain</h3>
      {props.poId && <p><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(props.poId)}`}>Open source Purchase Order</Link></p>}
      {props.links.length ? <div className="document-meta">{props.links.map((link, i) =>
        <div key={`${link.type || "document"}-${link.id || i}`}>
          <span>{String(link.type || "Related document").replace(/([A-Z])/g, " $1")}</span>
          <strong>{link.href?.startsWith("/") && !link.href.startsWith("//")
            ? <Link prefetch={false} href={link.href} title={link.number || link.id || "Open related document"}>{link.number || link.id || "Open"}</Link>
            : link.number || link.id || "—"}</strong>
        </div>)}</div> : <p className="small">No additional linked documents were found in the current document chain.</p>}
      <p><Link prefetch={false} href={`/document-explorer?documentId=${encodeURIComponent(props.billNumber)}`}>View full document relationship</Link></p>
    </div>}
    {tab === "accounting" && <div role="tabpanel">
      <h3>Accounting evidence</h3>
      {props.journalId
        ? <p>Posted source journal: <LinkedDocumentReference kind="journal" id={props.journalId}/></p>
        : <p className="small">No linked posted journal is available on this invoice yet. Do not treat this document as GL-posted without a journal reference.</p>}
      <p className="small">Invoice posting, input GST, GRNI and payable balances are maintained by the existing accounting engine. Open the journal to inspect actual debit and credit entries.</p>
      <p><Link prefetch={false} href={`/document-explorer?documentId=${encodeURIComponent(props.billNumber)}`}>Open document audit relationships</Link></p>
    </div>}
  </section>;
}
