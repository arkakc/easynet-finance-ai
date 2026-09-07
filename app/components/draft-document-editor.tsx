"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import TransactionItemLines, { type TransactionDraftLine, type TransactionItemMaster } from "@/app/components/transaction-item-lines";

type Props = {
  type: "quote" | "purchaseOrder" | "supplierBill" | "payment" | "expense";
  id: string;
  number: string;
  record: any;
  sourceLines: any[];
  items: TransactionItemMaster[];
  customers: any[];
  suppliers: any[];
  projects: any[];
  isSupplierQuotation?: boolean;
};

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

function lineIdFor(type: Props["type"], line: any) {
  if (type === "quote") return String(line.quoteLineId || "");
  if (type === "purchaseOrder") return String(line.poLineId || "");
  if (type === "supplierBill") return String(line.billLineId || "");
  return "";
}

function itemDisplay(item: any) {
  const code = String(item.itemCode || item.itemId || "");
  const name = String(item.itemName || code);
  return code && name !== code ? `${code} — ${name}` : name;
}

function initialLines(type: Props["type"], rows: any[], items: TransactionItemMaster[]): TransactionDraftLine[] {
  const itemMap = new Map(items.map((item) => [String(item.itemId || item.itemCode || ""), item]));
  return rows.map((row) => {
    const itemId = String(row.itemId || "");
    const item = itemMap.get(itemId);
    const name = String(item?.itemName || row.description || "");
    return {
      lineId: lineIdFor(type, row),
      itemId,
      itemInput: item ? itemDisplay(item) : name,
      itemName: name,
      itemType: String(item?.itemType || "STOCK"),
      description: String(row.description || name),
      qty: String(row.qty ?? 1),
      uom: String(row.uom || item?.uom || "Each"),
      rate: String(row.rate ?? 0),
    };
  });
}

export default function DraftDocumentEditor(props: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [partyId, setPartyId] = useState(String(props.record.customerId || props.record.supplierId || props.record.partyId || ""));
  const [projectId, setProjectId] = useState(String(props.record.projectId || ""));
  const [lines, setLines] = useState<TransactionDraftLine[]>(() => initialLines(props.type, props.sourceLines, props.items));
  const initialRate = Number(props.record.netAmount || 0) > 0
    ? Number(props.record.gstAmount || 0) / Number(props.record.netAmount || 0)
    : 0.1;
  const [gstRate, setGstRate] = useState(String(Number((initialRate * 100).toFixed(4))));

  const commercial = ["quote", "purchaseOrder", "supplierBill"].includes(props.type);
  const isSales = props.type === "quote";
  const temporaryQuotation = props.type === "quote" || Boolean(props.isSupplierQuotation);
  const partyOptions = isSales ? props.customers : props.suppliers;
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.rate) || 0), 0), [lines]);
  const gst = useMemo(() => subtotal * ((Number(gstRate) || 0) / 100), [subtotal, gstRate]);
  const total = subtotal + gst;
  const backHref = `/transactions/${props.type}/${encodeURIComponent(props.id)}`;

  async function saveCommercial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/erp/draft-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: props.type,
          id: props.id,
          partyId,
          projectId,
          documentDate: form.get("documentDate"),
          dueDate: form.get("dueDate") || "",
          expiryDate: form.get("expiryDate") || "",
          gstRate: (Number(gstRate) || 0) / 100,
          lines: lines.map((line) => ({
            lineId: line.lineId || "",
            itemId: line.itemId,
            itemName: line.itemName,
            itemType: line.itemType,
            description: line.description || line.itemName,
            qty: Number(line.qty),
            uom: line.uom,
            rate: Number(line.rate),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
      setStatus("Draft saved successfully.");
      router.push(backHref);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/erp/draft-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment",
          id: props.id,
          partyId,
          projectId,
          paymentDate: form.get("paymentDate"),
          amount: Number(form.get("amount") || 0),
          paymentMethod: form.get("paymentMethod"),
          cashBankAccountId: form.get("cashBankAccountId"),
          reference: form.get("reference") || "",
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
      setStatus("Draft saved successfully.");
      router.push(backHref);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/erp/draft-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          id: props.id,
          supplierId: form.get("supplierId") || "",
          projectId,
          expenseDate: form.get("expenseDate"),
          expenseAccountId: form.get("expenseAccountId"),
          description: form.get("description"),
          netAmount: Number(form.get("netAmount") || 0),
          gstAmount: Number(form.get("gstAmount") || 0),
          paymentMethod: form.get("paymentMethod"),
          cashBankAccountId: form.get("cashBankAccountId"),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
      setStatus("Draft saved successfully.");
      router.push(backHref);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <Link prefetch={false} href={backHref}>← Cancel Edit</Link>
      <strong>Edit Draft · {props.number}</strong>
    </div>
    {status && <section className="panel status-banner">{status}</section>}

    {commercial && <form className="panel" onSubmit={saveCommercial}>
      <div className="form-title-row"><div><h2>Edit Draft {props.isSupplierQuotation ? "Supplier Quotation" : props.type === "quote" ? "Sales Quotation" : props.type === "purchaseOrder" ? "Purchase Order" : "Supplier Invoice"}</h2><p className="small">Document ID/number is locked. Save is available only while the document remains DRAFT.</p></div><span className="auto-badge">{props.number}</span></div>
      <div className="form-grid">
        <label>{isSales ? "Customer" : "Supplier"}<select value={partyId} onChange={(event) => setPartyId(event.target.value)} required disabled={saving}><option value="" disabled>Select {isSales ? "customer" : "supplier"}</option>{partyOptions.map((row: any) => { const id = String(row.customerId || row.supplierId || ""); const name = String(row.customerName || row.supplierName || id); return <option key={id} value={id}>{name} ({id})</option>; })}</select></label>
        <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={saving}><option value="">No project</option>{props.projects.map((row: any) => <option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select></label>
        <label>Document ID / Number<input value={props.number} readOnly disabled /></label>
        <div></div>
        <label>Date<input name="documentDate" type="date" defaultValue={String(props.record.quoteDate || props.record.poDate || props.record.billDate || "")} required disabled={saving} /></label>
        {props.type === "quote" && <label>Valid Till<input name="expiryDate" type="date" defaultValue={String(props.record.expiryDate || "")} disabled={saving} /></label>}
        {props.type === "supplierBill" && <label>Due Date<input name="dueDate" type="date" defaultValue={String(props.record.dueDate || "")} disabled={saving} /></label>}
        <label>GST %<input type="number" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)} disabled={saving} /></label>
      </div>
      <h4>Items</h4>
      <TransactionItemLines lines={lines} items={props.items} temporaryQuotation={temporaryQuotation} masterOnly={!temporaryQuotation} disabled={saving} onChange={setLines} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}><div style={{ width: "min(420px,100%)", border: "1px solid #e5ebf2", borderRadius: 10, overflow: "hidden", background: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px" }}><span>Sub Total</span><strong>{money(subtotal)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px" }}><span>GST</span><strong>{money(gst)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", padding: 14, background: "#f8fafc", fontSize: 18 }}><strong>Total</strong><strong>{money(total)}</strong></div></div></div>
      <div className="button-row"><button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button><Link prefetch={false} className="button-link secondary-link" href={backHref}>Cancel</Link></div>
    </form>}

    {props.type === "payment" && <form className="panel form-grid" onSubmit={savePayment}>
      <h2 className="form-title">Edit Draft Payment / Receipt</h2>
      <label>Document ID / Number<input value={props.number} readOnly disabled /></label>
      <label>{String(props.record.partyType) === "Supplier" ? "Supplier" : "Customer"}<select value={partyId} onChange={(event) => setPartyId(event.target.value)} required disabled={saving}>{(String(props.record.partyType) === "Supplier" ? props.suppliers : props.customers).map((row: any) => { const id = String(row.customerId || row.supplierId || ""); const name = String(row.customerName || row.supplierName || id); return <option key={id} value={id}>{name} ({id})</option>; })}</select></label>
      <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={saving}><option value="">No project</option>{props.projects.map((row: any) => <option key={row.projectId} value={row.projectId}>{row.projectName}</option>)}</select></label>
      <label>Payment Date<input name="paymentDate" type="date" defaultValue={String(props.record.paymentDate || "")} required disabled={saving} /></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={Number(props.record.amount || 0)} required disabled={saving} /></label>
      <label>Payment Method<input name="paymentMethod" defaultValue={String(props.record.paymentMethod || "")} required disabled={saving} /></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue={String(props.record.cashBankAccountId || "")} required disabled={saving} /></label>
      <label className="form-wide">Reference<input name="reference" defaultValue={String(props.record.reference || "")} disabled={saving} /></label>
      <div className="form-wide button-row"><button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button><Link prefetch={false} className="button-link secondary-link" href={backHref}>Cancel</Link></div>
    </form>}

    {props.type === "expense" && <form className="panel form-grid" onSubmit={saveExpense}>
      <h2 className="form-title">Edit Draft Expense</h2>
      <label>Document ID / Number<input value={props.number} readOnly disabled /></label>
      <label>Date<input name="expenseDate" type="date" defaultValue={String(props.record.expenseDate || "")} required disabled={saving} /></label>
      <label>Supplier<select name="supplierId" defaultValue={String(props.record.supplierId || "")} disabled={saving}><option value="">No supplier</option>{props.suppliers.map((row: any) => <option key={row.supplierId} value={row.supplierId}>{row.supplierName} ({row.supplierId})</option>)}</select></label>
      <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={saving}><option value="">No project</option>{props.projects.map((row: any) => <option key={row.projectId} value={row.projectId}>{row.projectName}</option>)}</select></label>
      <label>Expense Account<input name="expenseAccountId" defaultValue={String(props.record.expenseAccountId || "ACC-6600")} required disabled={saving} /></label>
      <label>Net Amount<input name="netAmount" type="number" min="0" step="0.01" defaultValue={Number(props.record.netAmount || 0)} required disabled={saving} /></label>
      <label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue={Number(props.record.gstAmount || 0)} required disabled={saving} /></label>
      <label>Payment Method<input name="paymentMethod" defaultValue={String(props.record.paymentMethod || "")} required disabled={saving} /></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue={String(props.record.cashBankAccountId || "")} required disabled={saving} /></label>
      <label className="form-wide">Description<input name="description" defaultValue={String(props.record.description || "")} required disabled={saving} /></label>
      <div className="form-wide button-row"><button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button><Link prefetch={false} className="button-link secondary-link" href={backHref}>Cancel</Link></div>
    </form>}
  </div>;
}
