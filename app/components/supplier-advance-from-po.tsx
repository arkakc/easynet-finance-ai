"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  poId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  projectId: string;
  projectName: string;
  totalAmount: number;
};

type CashBankAccount = { accountId: string; accountCode: string; accountName: string; balance: number };
type Payment = { paymentId: string; paymentNumber?: string; amount?: number|string; status?: string; journalId?: string; againstDocumentId?: string; partyType?: string; partyId?: string; paymentType?: string; reference?: string; createdAt?: string };

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
function localDate(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(parts.map((p)=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;}
function createdValue(row: Payment){const value=row.createdAt||"";const t=new Date(value).getTime();return Number.isFinite(t)?t:0;}

export default function SupplierAdvanceFromPo(props: Props) {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [percentage, setPercentage] = useState("40");
  const [customAmount, setCustomAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const poMarker = `PO:${props.poId}|`;

  async function load() {
    setLoading(true);
    try {
      const [txResponse, refResponse] = await Promise.all([
        fetch("/api/erp/transactions", { cache: "no-store" }),
        fetch("/api/erp/reference-options", { cache: "no-store" }),
      ]);
      const [tx, refs] = await Promise.all([txResponse.json(), refResponse.json()]);
      if (!txResponse.ok || !tx.ok) throw new Error(tx.error || "Supplier advance history load failed");
      if (!refResponse.ok || !refs.ok) throw new Error(refs.error || "Cash / Bank account load failed");
      const rows = (tx.payments || []).filter((row: Payment) =>
        String(row.partyType || "") === "Supplier" &&
        String(row.paymentType || "").toUpperCase() === "PAY" &&
        String(row.partyId || "") === props.supplierId &&
        String(row.reference || "").startsWith(poMarker)
      );
      setPayments(rows);
      setAccounts(refs.cashBankAccounts || []);
      if (!accountId && refs.cashBankAccounts?.length) setAccountId(String(refs.cashBankAccounts[0].accountId || ""));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier advance setup load failed");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [props.poId]);

  const committedAdvance = useMemo(() => payments
    .filter((row) => !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase()))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0), [payments]);
  const postedAdvance = useMemo(() => payments
    .filter((row) => String(row.status || "").toUpperCase() === "POSTED" && Boolean(row.journalId))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0), [payments]);
  const remainingCapacity = Math.max(0, props.totalAmount - committedAdvance);
  const calculated = percentage === "CUSTOM"
    ? Number(customAmount || 0)
    : Number((props.totalAmount * (Number(percentage || 0) / 100)).toFixed(2));
  const amount = Math.min(calculated, remainingCapacity);
  const selectedAccount = accounts.find((row) => row.accountId === accountId) || null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!(amount > 0)) { setMessage("Advance amount must be greater than zero."); return; }
    if (calculated > remainingCapacity + 0.001) { setMessage(`PO advance cannot exceed PO total. Remaining advance capacity is ${money(remainingCapacity)}.`); return; }
    setBusy(true); setMessage("Saving Supplier Advance Payment Draft…");
    try {
      const userReference = reference.trim() || `Supplier advance against ${props.poNumber}`;
      const response = await fetch("/api/erp/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPayment",
          payload: {
            paymentNumber: "",
            paymentType: "PAY",
            partyType: "Supplier",
            partyId: props.supplierId,
            projectId: props.projectId || "",
            paymentDate: localDate(),
            amount,
            paymentMethod,
            cashBankAccountId: accountId,
            reference: `${poMarker}${userReference}`,
            againstDocumentType: "",
            againstDocumentId: "",
          },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Advance Payment Draft save failed");
      router.push(`/transactions/payment/${encodeURIComponent(body.result.recordId)}?returnModule=purchase&returnTab=purchaseOrder&returnMode=list`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier Advance Payment Draft save failed");
    } finally { setBusy(false); }
  }

  return <section className="panel no-print" style={{ marginTop: 20 }}>
    <div className="form-title-row">
      <div>
        <h3>Supplier Advance / Prepayment Against Purchase Order</h3>
        <p className="small">Use when the supplier requires 40%, 50%, 100% or another deposit before delivery. Final Save posts Dr Supplier Advances / Cr Cash or Bank. The advance is later allocated against the posted Supplier Invoice.</p>
      </div>
      <span className="auto-badge">PO {money(props.totalAmount)}</span>
    </div>

    <div className="document-meta" style={{ marginTop: 14 }}>
      <div><span>Supplier</span><strong>{props.supplierName} ({props.supplierId})</strong></div>
      <div><span>Project</span><strong>{props.projectId ? `${props.projectName} (${props.projectId})` : "No project"}</strong></div>
      <div><span>Advance Created</span><strong>{money(committedAdvance)}</strong></div>
      <div><span>Advance Posted</span><strong>{money(postedAdvance)}</strong></div>
      <div><span>Remaining PO Advance Capacity</span><strong>{money(remainingCapacity)}</strong></div>
    </div>

    {message && <div className="status-banner" style={{ marginTop: 14 }}>{message}</div>}

    {remainingCapacity > 0.001 && <form className="form-grid" onSubmit={save} style={{ marginTop: 18 }}>
      <label>Advance Requirement<select value={percentage} onChange={(event) => setPercentage(event.target.value)} disabled={busy || loading}><option value="40">40% of PO</option><option value="50">50% of PO</option><option value="100">100% of PO</option><option value="CUSTOM">Custom Amount</option></select></label>
      {percentage === "CUSTOM" ? <label>Custom Advance Amount<input type="number" min="0.01" max={remainingCapacity} step="0.01" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} required disabled={busy}/></label> : <label>Calculated Advance<input value={money(calculated)} readOnly /></label>}
      <label>Payment Amount<input value={money(amount)} readOnly /><span className="small">Cannot exceed remaining PO advance capacity.</span></label>
      <label>Payment Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} required disabled={busy || loading}><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required disabled={busy || loading}><option value="">Select Cash / Bank account</option>{accounts.map((row) => <option key={row.accountId} value={row.accountId}>{row.accountName} ({row.accountId}) · Balance {money(row.balance)}</option>)}</select>{selectedAccount && <span className="small">Available balance: <strong>{money(selectedAccount.balance)}</strong>. Insufficient balance will be blocked at Final Save.</span>}</label>
      <label>Reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={`Deposit / supplier reference for ${props.poNumber}`} disabled={busy}/></label>
      <div className="form-wide button-row"><button type="submit" disabled={busy || loading || !accountId || !paymentMethod || !(amount > 0)}>{busy ? "Saving…" : "Create Supplier Advance Payment Draft"}</button></div>
    </form>}

    {remainingCapacity <= 0.001 && <div className="status-banner" style={{ marginTop: 14 }}>The full Purchase Order value is already covered by created Supplier Advance Payment Entries. No additional advance can be created.</div>}

    {payments.length > 0 && <div className="table-wrap" style={{ marginTop: 20 }}><h4>PO-linked Supplier Advances</h4><table className="data-table"><thead><tr><th>Payment</th><th>Created</th><th>Amount</th><th>Status</th><th>Accounting</th></tr></thead><tbody>{[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map((row) => <tr key={row.paymentId}><td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber || row.paymentId}</strong></Link></td><td>{row.createdAt ? new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}) : "—"}</td><td>{money(row.amount)}</td><td>{row.status || "DRAFT"}</td><td>{row.journalId ? `Posted · ${row.journalId}` : "Not finalized"}</td></tr>)}</tbody></table></div>}
  </section>;
}
