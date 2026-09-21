"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AccountPicker from "@/app/components/account-picker";

export type ManualJournalAccount = {
  accountId: string;
  postingAccountId?: string;
  accountCode: string;
  accountName: string;
  accountType?: string;
  parentAccount?: string;
  active?: boolean;
  isGroup?: boolean;
  balance?: number;
};

type JournalLine = {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
};

type Props = {
  accounts: ManualJournalAccount[];
  baseCurrency: string;
  defaultPostingDate: string;
  editJournal?: {
    journalId: string;
    entryType: string;
    postingDate: string;
    remarks: string;
    lines: JournalLine[];
  } | null;
};

const blankLine = (description = ""): JournalLine => ({ accountId: "", debit: "", credit: "", description });
const numberValue = (value: string) => Number(value || 0);
const money = (value: number, currency: string) => new Intl.NumberFormat("en-PG", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);

const entryTypes = [
  ["JOURNAL_ENTRY", "Journal Entry"],
  ["INTER_COMPANY_JOURNAL_ENTRY", "Inter Company Journal Entry"],
  ["BANK_ENTRY", "Bank Entry"],
  ["CASH_ENTRY", "Cash Entry"],
  ["CREDIT_CARD_ENTRY", "Credit Card Entry"],
  ["DEBIT_NOTE", "Debit Note"],
  ["CREDIT_NOTE", "Credit Note"],
  ["CONTRA_ENTRY", "Contra Entry"],
  ["WRITE_OFF_ENTRY", "Write Off Entry"],
  ["OPENING_ENTRY", "Opening Entry"],
  ["DEPRECIATION_ENTRY", "Depreciation Entry"],
  ["EXCHANGE_RATE_REVALUATION", "Exchange Rate Revaluation"],
  ["DEFERRED_REVENUE", "Deferred Revenue"],
  ["DEFERRED_EXPENSE", "Deferred Expense"],
] as const;

const journalTypes = [
  ["GENERAL_JOURNAL", "General Journal"],
  ["SALES_RECEIVABLES_JOURNAL", "Sales & Receivables Journal"],
  ["PURCHASES_PAYABLES_JOURNAL", "Purchases & Payables Journal"],
  ["CASH_DISBURSEMENTS_JOURNAL", "Cash Disbursements Journal"],
  ["CASH_RECEIPTS_JOURNAL", "Cash Receipts Journal"],
] as const;

const DRAFT_KEY = "easynet:manual-journal-entry:draft:v1";

function optionLabel(options: readonly (readonly [string, string])[], value: string) {
  return options.find(([optionValue]) => optionValue === value)?.[1] || value;
}

export function ManualJournalEntryClient({ accounts, baseCurrency, defaultPostingDate, editJournal }: Props) {
  const router = useRouter();
  const [entryType, setEntryType] = useState("JOURNAL_ENTRY");
  const [journalType, setJournalType] = useState("GENERAL_JOURNAL");
  const [postingDate, setPostingDate] = useState(defaultPostingDate);
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([
    blankLine("Debit line"),
    blankLine("Credit line"),
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    if (editJournal) {
      setEntryType(editJournal.entryType || "JOURNAL_ENTRY");
      setPostingDate(editJournal.postingDate || defaultPostingDate);
      setRemarks(editJournal.remarks || "");
      setLines(editJournal.lines?.length ? editJournal.lines : [blankLine("Debit line"), blankLine("Credit line")]);
      setMessage("Editing unapproved journal. Save changes before approval.");
      setDraftReady(true);
      return;
    }
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore storage failures.
    } finally {
      setEntryType("JOURNAL_ENTRY");
      setJournalType("GENERAL_JOURNAL");
      setPostingDate(defaultPostingDate);
      setRemarks("");
      setLines([blankLine("Debit line"), blankLine("Credit line")]);
      setMessage("");
      setDraftReady(true);
    }
  }, [defaultPostingDate, editJournal]);


  const postingAccounts = useMemo(
    () => accounts.filter((account) => account.active !== false && !account.isGroup),
    [accounts],
  );
  const reference = useMemo(
    () => `${optionLabel(entryTypes, entryType)} · ${optionLabel(journalTypes, journalType)} · ${postingDate}`,
    [entryType, journalType, postingDate],
  );

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + numberValue(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + numberValue(line.credit), 0);
    return {
      debit,
      credit,
      difference: Math.round((debit - credit) * 100) / 100,
    };
  }, [lines]);

  const canPost = !busy
    && postingDate
    && reference.trim().length >= 3
    && lines.filter((line) => line.accountId && (numberValue(line.debit) > 0 || numberValue(line.credit) > 0)).length >= 2
    && Math.abs(totals.difference) < 0.01
    && totals.debit > 0;

  function updateLine(index: number, patch: Partial<JournalLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
    setMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setMessage("Submitting manual journal for checker approval…");
    try {
      const response = await fetch("/api/journals/manual", {
        method: editJournal ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId: editJournal?.journalId, entryType, journalType, postingDate, reference, remarks, lines }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Manual journal submission failed");
      setMessage(editJournal ? `Journal ${body.journalId} updated successfully. Returning to journal view…` : `Successfully drafted with Document ID ${body.manualId || body.journalId}.`);
      if (editJournal) {
        router.push(`/journals/${encodeURIComponent(body.journalId || editJournal.journalId)}`);
        router.refresh();
        return;
      }
      setLines([blankLine("Debit line"), blankLine("Credit line")]);
      setRemarks("");
      try {
        window.localStorage.removeItem(DRAFT_KEY);
        window.dispatchEvent(new Event("easynet:clear-form-drafts"));
      } catch {}
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manual journal submission failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="form-title-row">
        <div>
          <h3 className="form-title">Manual Journal Entry</h3>
          <p className="small">Maker step: prepare a balanced manual journal in company base currency {baseCurrency} and submit it for checker approval. PENDING journals do not affect the GL or financial reports.</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" disabled={busy} onClick={() => { setMessage("Refreshing ledger accounts without clearing your draft…"); router.refresh(); }}>
            Refresh ledger accounts
          </button>
          <span className="badge">MAKER → CHECKER</span>
        </div>
      </div>
      <form className="form-grid" data-draft-key="manual-journal-entry" onSubmit={submit}>
        <label>
          Entry type
          <select value={entryType} onChange={(event) => setEntryType(event.target.value)} required disabled={busy}>
            {entryTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Journal type
          <select value={journalType} onChange={(event) => setJournalType(event.target.value)} required disabled={busy}>
            {journalTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Posting date
          <input type="date" value={postingDate} onChange={(event) => setPostingDate(event.target.value)} required disabled={busy} />
        </label>
        <label>
          System narration
          <input value={reference} readOnly required minLength={3} aria-readonly="true" />
        </label>
        <label className="form-wide">
          Remarks
          <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} disabled={busy} placeholder="Write the business reason, explanation, or evidence note for this manual journal." />
        </label>
        <div className="form-wide table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account</th>
                <th>Description</th>
                <th>Debit ({baseCurrency})</th>
                <th>Credit ({baseCurrency})</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <AccountPicker
                      name={`journalAccount-${index}`}
                      value={line.accountId}
                      onChange={(accountId) => updateLine(index, { accountId })}
                      accounts={postingAccounts.map((account) => ({ ...account, accountId: account.postingAccountId || account.accountId }))}
                      required
                      disabled={busy}
                      placeholder="Search account by code or name"
                    />
                  </td>
                  <td><input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} disabled={busy} /></td>
                  <td><input type="number" min="0" step="0.01" value={line.debit} onChange={(event) => updateLine(index, { debit: event.target.value, credit: event.target.value ? "" : line.credit })} disabled={busy} /></td>
                  <td><input type="number" min="0" step="0.01" value={line.credit} onChange={(event) => updateLine(index, { credit: event.target.value, debit: event.target.value ? "" : line.debit })} disabled={busy} /></td>
                  <td><button type="button" className="secondary" disabled={busy || lines.length <= 2} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>Total</th>
                <th>{money(totals.debit, baseCurrency)}</th>
                <th>{money(totals.credit, baseCurrency)}</th>
                <th>{Math.abs(totals.difference) < 0.01 ? "Balanced" : `Diff ${money(Math.abs(totals.difference), baseCurrency)}`}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="form-wide button-row">
          <button type="button" className="secondary" disabled={busy} onClick={() => setLines((current) => [...current, blankLine("Journal line")])}>+ Add line</button>
          <button type="submit" disabled={!canPost} style={!canPost ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {message ? <div className="form-wide status-banner">{message}</div> : null}
      </form>
    </section>
  );
}
