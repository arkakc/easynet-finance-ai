"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SalesOrder = {
  quoteId: string;
  quoteNumber?: string;
  customerId?: string;
  projectId?: string;
  totalAmount?: number;
  status?: string;
  sourceDocumentId?: string;
};

type DeliveryNote = {
  deliveryId: string;
  deliveryNumber?: string;
  deliveryDate?: string;
  sourceDocumentId?: string;
  journalId?: string;
  status?: string;
};

type SalesInvoice = {
  invoiceId: string;
  invoiceNumber?: string;
  sourceDocumentId?: string;
  status?: string;
  totalAmount?: number;
};

type Warehouse = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  isDefault?: boolean;
};

function localDate(plusDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + plusDays);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function SalesOrderCycle({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [legacyInvoices, setLegacyInvoices] = useState<SalesInvoice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"delivery" | "invoice" | "">("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, warehouseResponse] = await Promise.all([
        fetch("/api/erp/transactions", { cache: "no-store" }),
        fetch("/api/erp/warehouse-options", { cache: "no-store" }),
      ]);
      const [body, warehouseBody] = await Promise.all([
        response.json(),
        warehouseResponse.json(),
      ]);
      if (!response.ok || !body.ok) throw new Error(body.error || "Sales Order lifecycle load failed");
      if (!warehouseResponse.ok || !warehouseBody.ok) throw new Error(warehouseBody.error || "Warehouse options failed");
      const current = ((body.salesOrders || []) as SalesOrder[]).find((row) => String(row.quoteId || "") === orderId) || null;
      if (!current) throw new Error("Sales Order not found in the sales lifecycle");
      const linkedDeliveries = ((body.deliveryNotes || []) as DeliveryNote[]).filter((row) => String(row.sourceDocumentId || "") === orderId);
      const directInvoices = ((body.invoices || []) as SalesInvoice[]).filter((row) => String(row.sourceDocumentId || "") === orderId);
      const legacyInvoices = directInvoices.length || !current.sourceDocumentId
        ? []
        : ((body.invoices || []) as SalesInvoice[]).filter((row) => String(row.sourceDocumentId || "") === String(current.sourceDocumentId || "") && Math.abs(Number(row.totalAmount || 0) - Number(current.totalAmount || 0)) < 0.01);
      setOrder(current);
      const activeWarehouses = (warehouseBody.warehouses || []) as Warehouse[];
      setWarehouses(activeWarehouses);
      setWarehouseId((currentWarehouse) => currentWarehouse || String((activeWarehouses.find((row) => row.isDefault) || activeWarehouses[0])?.warehouseId || ""));
      setDeliveryNotes(linkedDeliveries);
      setInvoices(directInvoices);
      setLegacyInvoices(legacyInvoices);
      setMessage(legacyInvoices.length ? "A legacy Sales Invoice was created from the source quotation. After Delivery Note, conversion will safely relink that draft to this Sales Order instead of creating a duplicate." : "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sales Order lifecycle load failed");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  async function createDeliveryNote() {
    if (!order || busy) return;
    setBusy("delivery");
    setMessage("Creating Delivery Note / Stock Out and posting COGS…");
    try {
      const response = await fetch("/api/erp/sales-delivery-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOrderId: orderId, deliveryDate: localDate(), warehouseId }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Delivery Note / Stock Out failed");
      setMessage(body.message || `Delivery Note ${body.deliveryNumber || ""} created and posted.`);
      await load();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delivery Note / Stock Out failed");
    } finally {
      setBusy("");
    }
  }

  async function createSalesInvoice() {
    if (!order || busy) return;
    setBusy("invoice");
    setMessage("Creating Sales Invoice from delivered Sales Order quantity…");
    try {
      const response = await fetch("/api/erp/sales-invoice-conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: orderId, mode: "FULL", invoiceDate: localDate(), dueDate: localDate(30) }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Sales Invoice conversion failed");
      router.push(`/transactions/invoice/${encodeURIComponent(body.createdId)}?returnModule=sales&returnTab=salesOrder&returnMode=list`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sales Invoice conversion failed");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <section className="conversion-box no-print"><strong>Sales Order Lifecycle</strong><p className="small">Loading Delivery Note, stock posting and Sales Invoice links…</p></section>;
  if (!order) return message ? <div className="status-banner no-print" style={{ marginTop: 16 }}>{message}</div> : null;

  const status = String(order.status || "DRAFT").toUpperCase();
  const canDeliver = ["APPROVED", "PART_DELIVERED"].includes(status);
  const deliveryComplete = status === "DELIVERED";
  const activeInvoice = invoices.find((row) => !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase()));

  return <section className="conversion-box no-print" style={{ marginTop: 16 }}>
    <div className="form-title-row">
      <div><strong>Sales Order → Delivery Note / Stock Out → Sales Invoice</strong><p className="small">Stock items post Dr COGS / Cr Inventory at Delivery Note. The Sales Invoice posts Dr Accounts Receivable / Cr Revenue and GST.</p></div>
      <span className="auto-badge">{status}</span>
    </div>
    {order.sourceDocumentId && <div className="button-row" style={{ marginTop: 12 }}><Link prefetch={false} className="button-link secondary-link" href={`/transactions/quote/${encodeURIComponent(order.sourceDocumentId)}?returnModule=sales&returnTab=salesQuote&returnMode=list`}>Source Sales Quotation</Link></div>}
    {deliveryNotes.length > 0 && <div className="document-meta" style={{ marginTop: 14 }}>{deliveryNotes.map((delivery) => <div key={delivery.deliveryId}><span>Delivery Note / Stock Out</span><strong>{delivery.deliveryNumber || delivery.deliveryId}</strong>{delivery.journalId && <><br/><Link prefetch={false} href={`/journals/${encodeURIComponent(delivery.journalId)}`}>Journal {delivery.journalId}</Link></>}</div>)}</div>}
    {activeInvoice && <div className="document-meta" style={{ marginTop: 14 }}><div><span>Linked Sales Invoice</span><strong><Link prefetch={false} href={`/transactions/invoice/${encodeURIComponent(activeInvoice.invoiceId)}`}>{activeInvoice.invoiceNumber || activeInvoice.invoiceId}</Link></strong></div><div><span>Invoice Status</span><strong>{activeInvoice.status}</strong></div></div>}
    {canDeliver && !activeInvoice && <div className="form-grid" style={{ marginTop: 14 }}>
      <label>Fulfil From Warehouse
        <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required disabled={Boolean(busy)}>
          <option value="">Select warehouse</option>
          {warehouses.map((warehouse) => <option key={warehouse.warehouseId} value={warehouse.warehouseId}>{warehouse.warehouseCode} — {warehouse.warehouseName}</option>)}
        </select>
      </label>
    </div>}
    <div className="button-row" style={{ marginTop: 14 }}>
      {canDeliver && !activeInvoice && <button type="button" disabled={Boolean(busy) || !warehouseId} onClick={() => void createDeliveryNote()}>{busy === "delivery" ? "Posting Stock Out…" : "Create Delivery Note / Stock Out"}</button>}
      {deliveryComplete && !activeInvoice && <button type="button" disabled={Boolean(busy)} onClick={() => void createSalesInvoice()}>{busy === "invoice" ? "Creating Invoice…" : legacyInvoices.length ? "Link Draft Invoice to Delivered Sales Order" : "Convert Delivery to Sales Invoice"}</button>}
      {status === "DRAFT" && <button type="button" disabled>Approve Sales Order First</button>}
    </div>
    {message && <div className="status-banner" style={{ marginTop: 12 }}>{message}</div>}
  </section>;
}
