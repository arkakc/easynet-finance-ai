"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function DocumentConversionActions({ type, id, status }: { type: string; id: string; status: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canQuote = type === "quote" && ["APPROVED", "CONVERTED"].includes(status.toUpperCase());
  const canPo = type === "purchaseOrder" && ["APPROVED", "BILL_CREATED", "BILLED"].includes(status.toUpperCase());
  if (!canQuote && !canPo) return null;

  async function convert() {
    setBusy(true); setMessage("");
    const action = canQuote ? "quoteToInvoice" : "poToBill";
    const payload = canQuote
      ? { quoteId: id, invoiceDate: today(), dueDate: "", revenueAccountId: "ACC-4100" }
      : { poId: id, billDate: today(), dueDate: "", costAccountId: "ACC-5100" };
    const response = await fetch("/api/erp/conversions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok || !body.ok) { setMessage(body.error || "Conversion failed"); return; }
    const targetType = canQuote ? "invoice" : "supplierBill";
    router.push(`/transactions/${targetType}/${body.createdId}`);
    router.refresh();
  }

  return <div className="conversion-box no-print"><strong>Next Document</strong><p className="small">ERP-style mapped conversion keeps party, project, values and line items linked to this source document.</p><button type="button" disabled={busy} onClick={convert}>{busy ? "Creating…" : canQuote ? "Create Sales Invoice" : "Create Supplier Bill"}</button>{message && <span className="small">{message}</span>}</div>;
}
