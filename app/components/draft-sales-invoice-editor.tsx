"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import TransactionItemLines, {
  type TransactionDraftLine,
  type TransactionItemMaster,
} from "@/app/components/transaction-item-lines";

type EditableLine = TransactionDraftLine & { invoiceLineId?: string };

type Props = {
  invoice: {
    invoiceId: string;
    invoiceNumber: string;
    customerId: string;
    projectId?: string;
    invoiceDate: string;
    dueDate?: string;
    netAmount?: number | string;
    gstAmount?: number | string;
  };
  customerLabel: string;
  sourceLines: any[];
  items: TransactionItemMaster[];
};

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

function displayItem(item: TransactionItemMaster | undefined, fallback: string) {
  if (!item) return fallback;
  const code = String(item.itemCode || item.itemId || "");
  const name = String(item.itemName || code);
  return code && name !== code ? `${code} — ${name}` : name;
}

export default function DraftSalesInvoiceEditor({ invoice, customerLabel, sourceLines, items }: Props) {
  const router = useRouter();
  const itemMap = useMemo(() => new Map(items.map((item) => [String(item.itemId || item.itemCode || ""), item])), [items]);
  const initialLines = useMemo<EditableLine[]>(() => sourceLines.map((line) => {
    const itemId = String(line.itemId || "");
    const item = itemMap.get(itemId);
    return {
      invoiceLineId: String(line.invoiceLineId || ""),
      itemId,
      itemInput: displayItem(item, String(line.description || itemId)),
      itemName: String(item?.itemName || line.description || ""),
      itemType: String(item?.itemType || "STOCK"),
      description: String(line.description || item?.itemName || ""),
      qty: String(line.qty ?? 1),
      uom: String(line.uom || item?.uom || "Each"),
      rate: String(line.rate ?? 0),
    };
  }), [sourceLines, itemMap]);

  const originalNet = Number(invoice.netAmount || 0);
  const originalGst = Number(invoice.gstAmount || 0);
  const initialGstPct = originalNet > 0 ? (originalGst / originalNet) * 100 : 10;

  const [lines, setLines] = useState<EditableLine[]>(initialLines.length ? initialLines : []);
  const [invoiceDate, setInvoiceDate] = useState(String(invoice.invoiceDate || ""));
  const [dueDate, setDueDate] = useState(String(invoice.dueDate || ""));
  const [gstRate, setGstRate] = useState(String(Number(initialGstPct.toFixed(4))));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.rate) || 0), 0), [lines]);
  const gstAmount = useMemo(() => subtotal * ((Number(gstRate) || 0) / 100), [subtotal, gstRate]);
  const total = subtotal + gstAmount;

  function changeLines(next: TransactionDraftLine[]) {
    const normalized = next.map((line) => {
      const current = line as EditableLine;
      if (current.invoiceLineId) return current;
      return { ...current, invoiceLineId: `${invoice.invoiceId}-EDIT-${crypto.randomUUID().slice(0, 12).toUpperCase()}` };
    });
    setLines(normalized);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!lines.length) { setStatus("At least one Item line is required"); return; }
    const unlinked = lines.findIndex((line) => !String(line.itemId || "").trim());
    if (unlinked >= 0) { setStatus(`Line ${unlinked + 1}: select an Item Master record before Save`); return; }

    setSaving(true);
    setStatus("Saving Sales Invoice…");
    try {
      const response = await fetch("/api/erp/draft-sales-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.invoiceId,
          invoiceDate,
          dueDate,
          gstRate: (Number(gstRate) || 0) / 100,
          lines: lines.map((line) => ({
            invoiceLineId: line.invoiceLineId,
            itemId: line.itemId,
            itemCode: line.itemId,
            itemName: line.itemName,
            itemType: line.itemType,
            description: line.itemName || line.description,
            qty: Number(line.qty),
            uom: line.uom,
            rate: Number(line.rate),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Draft Sales Invoice save failed");
      setStatus("Sales Invoice saved successfully.");
      router.push(`/transactions/invoice/${encodeURIComponent(invoice.invoiceId)}`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Draft Sales Invoice save failed");
    } finally {
      setSaving(false);
    }
  }

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <Link prefetch={false} href={`/transactions/invoice/${encodeURIComponent(invoice.invoiceId)}`}>← Back to Sales Invoice</Link>
    </div>

    <section className="document-sheet">
      <header className="document-header">
        <div>
          <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
          <h1>Edit Draft Sales Invoice</h1>
          <div className="document-number">{invoice.invoiceNumber}</div>
        </div>
        <div className="status-pill status-draft">DRAFT</div>
      </header>

      <form onSubmit={save}>
        <div className="form-grid">
          <label>Customer<input value={customerLabel || invoice.customerId} readOnly /></label>
          <label>Project<input value={String(invoice.projectId || "No project")} readOnly /></label>
          <label>Invoice Date<input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} required /></label>
          <label>Due Date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label>GST %<input type="number" min="0" max="100" step="0.0001" value={gstRate} onChange={(event) => setGstRate(event.target.value)} required /></label>
        </div>

        <h3 style={{ marginTop: 24 }}>Items</h3>
        <TransactionItemLines lines={lines} items={items} masterOnly onChange={changeLines} />

        <div style={{ maxWidth: 470, marginLeft: "auto", marginTop: 20 }}>
          <div className="document-meta">
            <div><span>Sub Total</span><strong>{money(subtotal)}</strong></div>
            <div><span>GST</span><strong>{money(gstAmount)}</strong></div>
            <div><span>Total</span><strong>{money(total)}</strong></div>
          </div>
        </div>

        <div className="button-row no-print" style={{ marginTop: 20 }}>
          <button type="submit" disabled={saving}>{saving ? "Saving Sales Invoice…" : "Save Draft Sales Invoice"}</button>
          <Link prefetch={false} className="button-link secondary-link" href={`/transactions/invoice/${encodeURIComponent(invoice.invoiceId)}`}>Cancel</Link>
        </div>
        {status && <div className="small" style={{ marginTop: 10 }}>{status}</div>}
      </form>
    </section>
  </div>;
}
