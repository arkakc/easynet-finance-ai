"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type BankAccount = { id: string; code: string; name: string; bankName: string; accountNumber: string; currency: string; chartOfAccountsId: string | null; chartOfAccounts?: { id: string; code: string; name: string } | null };
type LedgerAccount = { id: string; code: string; name: string };
type Payment = { id: string; code: string; date: string; amount: number; type: string; party: string; reference: string };
type Suggestion = Payment & { score: number };
type BankRow = { id: string; code: string; date: string; description: string; referenceNumber: string | null; amount: number; statementBalance: number | null; matchStatus: "UNMATCHED" | "MATCHED" | "REVIEWED"; matchNotes: string | null; matchedPayment?: { id: string; code: string; amount: number } | null; isReconciled: boolean; suggestions: Suggestion[] };
type Reconciliation = { id: string; periodStart: string; periodEnd: string; statementBalance: number; bookBalance: number; difference: number; status: string };
type Preview = { ok: boolean; error?: string; message?: string; summary?: { received: number; valid: number; invalid: number; duplicates: number; willImport: number; totalDeposits: number; totalWithdrawals: number }; rows?: Array<{ rowNumber: number; date: string; description: string; referenceNumber: string; amount: number; statementBalance: number | null; action: string; errors: string[] }> };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthStart = `${today.slice(0, 8)}01`;
const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK" }).format(value);

export default function BankReconciliationPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [transactions, setTransactions] = useState<BankRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [balances, setBalances] = useState<{ statement: number | null; book: number | null }>({ statement: null, book: null });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [statementBalance, setStatementBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (requestedId = "") => {
    const query = requestedId;
    const response = await fetch(`/api/banking/reconciliation${query ? `?bankAccountId=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Could not load bank reconciliation workspace");
    setAccounts(body.accounts || []);
    setBankAccountId(body.selectedAccountId || "");
    setLedgerAccounts(body.ledgerAccounts || []);
    setTransactions(body.transactions || []);
    setPayments(body.payments || []);
    setReconciliations(body.reconciliations || []);
    setBalances(body.balances || { statement: null, book: null });
    const selected = (body.accounts || []).find((row: BankAccount) => row.id === body.selectedAccountId);
    setLedgerAccountId(selected?.chartOfAccountsId || "");
    if (body.balances?.statement !== null && body.balances?.statement !== undefined) setStatementBalance(String(body.balances.statement));
    const suggestedChoices: Record<string, string> = {};
    for (const row of body.transactions || []) if (row.suggestions?.[0]) suggestedChoices[row.id] = row.suggestions[0].id;
    setChoices(suggestedChoices);
  }, []);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Load failed")); }, [load]);
  const selectedAccount = accounts.find((row) => row.id === bankAccountId) || null;
  const outstanding = useMemo(() => transactions.filter((row) => !row.isReconciled && row.matchStatus === "UNMATCHED").length, [transactions]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/banking/reconciliation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Bank action failed");
      setMessage(result.message || "Saved");
      await load(bankAccountId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bank action failed"); }
    finally { setBusy(false); }
  };

  const upload = async (mode: "preview" | "commit") => {
    if (!file || !bankAccountId) return setPreview({ ok: false, error: "Select a bank account and statement file" });
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("bankAccountId", bankAccountId); form.set("mode", mode);
      if (mode === "commit") form.set("confirmation", confirmation);
      const response = await fetch("/api/banking/reconciliation", { method: "POST", body: form });
      const result = await response.json();
      setPreview(result);
      if (!response.ok || !result.ok) return;
      if (mode === "commit") { setMessage(result.message); setConfirmation(""); await load(bankAccountId); }
    } catch (error) { setPreview({ ok: false, error: error instanceof Error ? error.message : "Statement import failed" }); }
    finally { setBusy(false); }
  };

  const submitPreview = (event: FormEvent) => { event.preventDefault(); void upload("preview"); };

  return (
    <div className="page-stack">
      <section className="page-header"><div><span className="badge">Banking</span><h1>Bank Statement & Reconciliation</h1><p>Import PNG bank statements, match them to ERP payments, and close only when bank and General Ledger agree.</p></div></section>
      {message && <section className="panel"><strong>{message}</strong></section>}

      <section className="panel">
        <div className="form-title-row"><div><h2>1. Bank and ledger mapping</h2><p className="small">Each physical bank account must point to one leaf General Ledger bank account.</p></div><span className="auto-badge">{selectedAccount?.currency || "PGK"}</span></div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>Bank account<select value={bankAccountId} required disabled={busy} onChange={(event) => { const id = event.target.value; setBankAccountId(id); setPreview(null); void load(id); }}>{accounts.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name} {row.accountNumber}</option>)}</select></label>
          <label>General Ledger account<select value={ledgerAccountId} required disabled={busy} onChange={(event) => setLedgerAccountId(event.target.value)}><option value="">Select ledger account</option>{ledgerAccounts.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
          <div className="form-wide button-row"><button type="button" disabled={busy || !bankAccountId || !ledgerAccountId || ledgerAccountId === selectedAccount?.chartOfAccountsId} onClick={() => void patch({ action: "configure", bankAccountId, chartOfAccountsId: ledgerAccountId })}>Save ledger mapping</button></div>
        </div>
        <div className="document-meta" style={{ marginTop: 16 }}><div><span>Latest statement balance</span><strong>{money(balances.statement)}</strong></div><div><span>General Ledger balance</span><strong>{money(balances.book)}</strong></div><div><span>Unmatched rows</span><strong>{outstanding}</strong></div></div>
      </section>

      <section className="panel">
        <div className="form-title-row"><div><h2>2. Import statement</h2><p className="small">Supports BSP, Kina and generic CSV/XLS/XLSX columns for date, description, reference, debit, credit, amount and balance.</p></div><span className="auto-badge">Duplicate protected</span></div>
        <form className="form-grid" style={{ marginTop: 16 }} onSubmit={submitPreview}>
          <label className="form-wide">Statement file<input type="file" accept=".csv,.xlsx,.xls" required disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} /></label>
          <div className="form-wide button-row"><button type="submit" disabled={busy || !file || !bankAccountId}>{busy ? "Checking…" : "Preview statement"}</button></div>
        </form>
        {preview && <div className="conversion-box" style={{ marginTop: 18 }}>
          <strong>{preview.error || preview.message || "Statement preview"}</strong>
          {preview.summary && <><div className="document-meta" style={{ marginTop: 12 }}><div><span>Rows</span><strong>{preview.summary.received}</strong></div><div><span>New</span><strong>{preview.summary.willImport}</strong></div><div><span>Duplicates</span><strong>{preview.summary.duplicates}</strong></div><div><span>Invalid</span><strong>{preview.summary.invalid}</strong></div><div><span>Deposits</span><strong>{money(preview.summary.totalDeposits)}</strong></div><div><span>Withdrawals</span><strong>{money(preview.summary.totalWithdrawals)}</strong></div></div>
          {preview.rows?.length ? <div className="table-wrap" style={{ marginTop: 16 }}><table className="data-table"><thead><tr><th>Row</th><th>Date</th><th>Description</th><th>Reference</th><th>Amount</th><th>Balance</th><th>Action</th><th>Validation</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={`${row.rowNumber}-${row.referenceNumber}`}><td>{row.rowNumber}</td><td>{row.date || "—"}</td><td>{row.description || "—"}</td><td>{row.referenceNumber || "—"}</td><td>{money(row.amount)}</td><td>{money(row.statementBalance)}</td><td>{row.action}</td><td>{row.errors.join("; ") || "Valid"}</td></tr>)}</tbody></table></div> : null}
          {preview.summary.invalid === 0 && <div className="button-row" style={{ marginTop: 14 }}><input value={confirmation} required disabled={busy} onChange={(event) => setConfirmation(event.target.value)} placeholder="IMPORT STATEMENT" style={{ maxWidth: 300 }} /><button type="button" disabled={busy || confirmation !== "IMPORT STATEMENT"} onClick={() => void upload("commit")}>Import {preview.summary.willImport} new rows</button></div>}</>}
        </div>}
      </section>

      <section className="panel table-wrap">
        <div className="form-title-row"><div><h2>3. Match statement transactions</h2><p className="small">Exact amount, payment direction, date and reference are used to rank suggestions.</p></div><span className="auto-badge">{transactions.length} transactions</span></div>
        <table className="data-table" style={{ marginTop: 16, minWidth: 1180 }}><thead><tr><th>Date</th><th>Description / Reference</th><th>Amount</th><th>Statement balance</th><th>Status</th><th>Match or review</th></tr></thead><tbody>
          {!transactions.length && <tr><td colSpan={6}>No bank statements imported for this account.</td></tr>}
          {transactions.map((row) => <tr key={row.id}><td>{row.date}</td><td><strong>{row.description}</strong><br/><span className="small">{row.referenceNumber || row.code}</span></td><td><strong>{money(row.amount)}</strong></td><td>{money(row.statementBalance)}</td><td>{row.isReconciled ? "RECONCILED" : row.matchStatus}<br/><span className="small">{row.matchedPayment?.code || row.matchNotes || ""}</span></td><td>
            {row.matchStatus === "UNMATCHED" ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><select value={choices[row.id] || ""} disabled={busy} onChange={(event) => setChoices((current) => ({ ...current, [row.id]: event.target.value }))}><option value="">Select ERP payment</option>{row.suggestions.map((item) => <option key={item.id} value={item.id}>Suggested {item.score}% · {item.code} · {item.date} · {item.party}</option>)}{payments.filter((payment) => !row.suggestions.some((item) => item.id === payment.id)).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.date} · {money(item.amount)} · {item.party}</option>)}</select><div className="button-row"><button type="button" disabled={busy || !choices[row.id]} onClick={() => void patch({ action: "match", transactionId: row.id, paymentId: choices[row.id] })}>Match</button><input value={reviewNotes[row.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Manual review reason"/><button type="button" className="secondary" disabled={busy || (reviewNotes[row.id] || "").trim().length < 5} onClick={() => void patch({ action: "review", transactionId: row.id, notes: reviewNotes[row.id] })}>Mark reviewed</button></div></div> : <button type="button" className="secondary" disabled={busy || row.isReconciled} onClick={() => void patch({ action: "unmatch", transactionId: row.id })}>Remove match</button>}
          </td></tr>)}
        </tbody></table>
      </section>

      <section className="panel">
        <div className="form-title-row"><div><h2>4. Complete reconciliation</h2><p className="small">Completion is blocked until every row is matched/reviewed and the statement balance equals the GL balance.</p></div><span className="auto-badge">Controller approval</span></div>
        <div className="form-grid" style={{ marginTop: 16 }}><label>Period start<input type="date" value={periodStart} required disabled={busy} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>Period end<input type="date" value={periodEnd} required disabled={busy} onChange={(event) => setPeriodEnd(event.target.value)} /></label><label>Statement closing balance<input type="number" step="0.01" value={statementBalance} required disabled={busy} onChange={(event) => setStatementBalance(event.target.value)} /></label><label>Review notes<input value={notes} required disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label><div className="form-wide button-row"><button type="button" disabled={busy || !bankAccountId || !periodStart || !periodEnd || statementBalance === "" || notes.trim().length < 3} onClick={() => void patch({ action: "reconcile", bankAccountId, periodStart, periodEnd, statementBalance: Number(statementBalance), notes })}>Complete reconciliation</button></div></div>
      </section>

      <section className="panel table-wrap"><div className="form-title-row"><h2>Completed reconciliations</h2><span className="auto-badge">{reconciliations.length}</span></div><table className="data-table" style={{ marginTop: 16 }}><thead><tr><th>Period</th><th>Statement</th><th>Book</th><th>Difference</th><th>Status</th></tr></thead><tbody>{!reconciliations.length && <tr><td colSpan={5}>No completed reconciliations.</td></tr>}{reconciliations.map((row) => <tr key={row.id}><td>{row.periodStart} — {row.periodEnd}</td><td>{money(row.statementBalance)}</td><td>{money(row.bookBalance)}</td><td>{money(row.difference)}</td><td>{row.status}</td></tr>)}</tbody></table></section>
    </div>
  );
}
