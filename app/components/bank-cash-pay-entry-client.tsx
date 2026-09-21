"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AccountPicker, { type AccountPickerOption } from "@/app/components/account-picker";

type PayLine = {
  accountId: string;
  description: string;
  amount: string;
  projectId: string;
};

type Project = { projectId: string; projectName?: string; name?: string; code?: string };

const blankLine = (): PayLine => ({ accountId: "", description: "", amount: "", projectId: "" });
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);
const DRAFT_KEY = "easynet:bank-cash-pay-entry:draft:v1";

export default function BankCashPayEntryClient() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountPickerOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [journalId, setJournalId] = useState("");
  const [postingDate, setPostingDate] = useState(today());
  const [paymentType, setPaymentType] = useState<"CASH" | "BANK">("CASH");
  const [paidFromAccountId, setPaidFromAccountId] = useState("");
  const [payeeType, setPayeeType] = useState("OTHER");
  const [payeeName, setPayeeName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<PayLine[]>([blankLine()]);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadReferences(showMessage = false) {
      try {
        if (showMessage) setMessage("Refreshing accounts and projects without clearing your draft…");
        const [refResponse, masterResponse] = await Promise.all([
          fetch("/api/erp/reference-options", { cache: "no-store" }),
          fetch("/api/masters", { cache: "no-store" }),
        ]);
        const [refBody, masterBody] = await Promise.all([refResponse.json(), masterResponse.json()]);
        if (!refResponse.ok || !refBody.ok) throw new Error(refBody.error || "Account options failed");
        if (!masterResponse.ok || !masterBody.ok) throw new Error(masterBody.error || "Project options failed");
        if (!active) return;
        setAccounts(refBody.accounts || []);
        setProjects(masterBody.projects || []);
        const firstCashBank = (refBody.cashBankAccounts || [])[0];
        setPaidFromAccountId((current) => current || (firstCashBank?.accountId ? String(firstCashBank.accountId) : ""));
        if (showMessage) setMessage("Accounts and projects refreshed. Your unsaved payment draft is still here.");
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Reference data load failed");
      } finally {
        if (active) setLoading(false);
      }
    }
    const refreshHandler = () => void loadReferences(true);
    void loadReferences();
    window.addEventListener("easynet:refresh-bank-cash-references", refreshHandler);
    return () => {
      active = false;
      window.removeEventListener("easynet:refresh-bank-cash-references", refreshHandler);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<{
          postingDate: string;
          paymentType: "CASH" | "BANK";
          paidFromAccountId: string;
          payeeType: string;
          payeeName: string;
          remarks: string;
          lines: PayLine[];
        }>;
        if (draft.postingDate) setPostingDate(draft.postingDate);
        if (draft.paymentType) setPaymentType(draft.paymentType);
        if (draft.paidFromAccountId) setPaidFromAccountId(draft.paidFromAccountId);
        if (draft.payeeType) setPayeeType(draft.payeeType);
        if (typeof draft.payeeName === "string") setPayeeName(draft.payeeName);
        if (typeof draft.remarks === "string") setRemarks(draft.remarks);
        if (Array.isArray(draft.lines) && draft.lines.length) setLines(draft.lines);
        setMessage("Local draft restored. You can continue without re-entering the payment.");
      }
    } catch {
      // Ignore corrupt local drafts.
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady || busy) return;
    const hasDraft = paidFromAccountId || payeeName.trim() || remarks.trim() || lines.some((line) => line.accountId || line.description.trim() || line.amount || line.projectId);
    try {
      if (!hasDraft) {
        window.localStorage.removeItem(DRAFT_KEY);
        return;
      }
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ postingDate, paymentType, paidFromAccountId, payeeType, payeeName, remarks, lines, updatedAt: new Date().toISOString() }));
    } catch {
      // Ignore storage failures.
    }
  }, [draftReady, busy, postingDate, paymentType, paidFromAccountId, payeeType, payeeName, remarks, lines]);

  const total = useMemo(() => lines.reduce((sum, line) => sum + Number(line.amount || 0), 0), [lines]);
  const reference = useMemo(() => {
    const payee = payeeName.trim() || "No payee reference";
    return `${paymentType === "CASH" ? "Cash" : "Bank"} Pay Entry · ${payeeType} · ${payee} · ${postingDate}`;
  }, [paymentType, payeeType, payeeName, postingDate]);
  const canPost = !busy && !loading && postingDate && paidFromAccountId && reference.trim().length >= 3 && total > 0 && lines.every((line) => line.accountId && line.description.trim().length >= 2 && Number(line.amount || 0) > 0);

  function updateLine(index: number, patch: Partial<PayLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
    setMessage("");
    setJournalId("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setMessage("Approving source document and posting journal…");
    setJournalId("");
    try {
      const response = await fetch("/api/bank-cash-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingDate, paymentType, paidFromAccountId, payeeType, payeeName, reference, remarks, lines }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Bank/Cash Pay Entry failed");
      setJournalId(String(body.journalId || ""));
      setMessage(`Successfully posted ${body.voucherId} as journal ${body.journalId}.`);
      setLines([blankLine()]);
      setRemarks("");
      setPayeeName("");
      try {
        window.localStorage.removeItem(DRAFT_KEY);
        window.dispatchEvent(new Event("easynet:clear-form-drafts"));
      } catch {}
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bank/Cash Pay Entry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="form-title-row">
        <div>
          <h2 className="form-title">Bank / Cash Pay Entry</h2>
          <p className="small">Create a controlled payment source document. On submit, the system approves it and posts a linked journal: debit particulars, credit cash/bank.</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" disabled={busy} onClick={() => window.dispatchEvent(new Event("easynet:refresh-bank-cash-references"))}>
            Refresh accounts/projects
          </button>
          <span className="badge">SOURCE → JOURNAL</span>
        </div>
      </div>
      <form className="form-grid" data-draft-key="bank-cash-pay-entry" onSubmit={submit}>
        <label>Payment type<select value={paymentType} onChange={(event) => setPaymentType(event.target.value as "CASH" | "BANK")} disabled={busy || loading}><option value="CASH">Cash</option><option value="BANK">Bank</option></select></label>
        <label>Posting date<input type="date" value={postingDate} onChange={(event) => setPostingDate(event.target.value)} required disabled={busy || loading} /></label>
        <label>Paid from cash/bank account<AccountPicker name="paidFromAccountId" value={paidFromAccountId} onChange={setPaidFromAccountId} accounts={accounts} kind="cash-bank" required disabled={busy || loading} placeholder="Search cash/bank account" /></label>
        <label>Payee type<select value={payeeType} onChange={(event) => setPayeeType(event.target.value)} disabled={busy || loading}><option value="SUPPLIER">Supplier</option><option value="EMPLOYEE">Employee</option><option value="CUSTOMER">Customer</option><option value="OWNER">Owner</option><option value="OTHER">Other</option></select></label>
        <label>Payee name / reference<input value={payeeName} onChange={(event) => setPayeeName(event.target.value)} disabled={busy || loading} placeholder="e.g. Amani Thomas / BSP fee / supplier name" /></label>
        <label>System narration<input value={reference} readOnly required minLength={3} aria-readonly="true" /></label>
        <label className="form-wide">Remarks<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} disabled={busy || loading} placeholder="Write the business reason, receipt details, or evidence note for this payment voucher." /></label>
        <div className="form-wide table-wrap">
          <table className="data-table">
            <thead><tr><th>#</th><th>Debit account</th><th>Description</th><th>Project</th><th>Amount</th><th>Action</th></tr></thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td><AccountPicker name={`lineAccount${index}`} value={line.accountId} onChange={(value) => updateLine(index, { accountId: value })} accounts={accounts} kind="all" required disabled={busy || loading} placeholder="Search expense/AP/liability account" /></td>
                  <td><input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} required disabled={busy || loading} /></td>
                  <td><select value={line.projectId} onChange={(event) => updateLine(index, { projectId: event.target.value })} disabled={busy || loading}><option value="">No project</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName || project.name || project.code || project.projectId}</option>)}</select></td>
                  <td><input type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} required disabled={busy || loading} /></td>
                  <td><button type="button" className="secondary" disabled={busy || loading || lines.length <= 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={4}>Total paid</th><th>{money(total)}</th><th /></tr></tfoot>
          </table>
        </div>
        <div className="form-wide button-row">
          <button type="button" className="secondary" disabled={busy || loading} onClick={() => setLines((current) => [...current, blankLine()])}>+ Add particular</button>
          <button type="submit" disabled={!canPost} style={!canPost ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}>{busy ? "Posting…" : "Approve & Post Bank/Cash Pay Entry"}</button>
          {journalId ? <Link className="button-link secondary-link" href={`/journals/${encodeURIComponent(journalId)}`}>View Posted Journal</Link> : null}
        </div>
        {message ? <div className="form-wide status-banner">{message}</div> : null}
      </form>
    </section>
  );
}
