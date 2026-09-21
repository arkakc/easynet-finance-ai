"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type RevaluationRow = {
  revaluationId: string;
  revaluationCode: string;
  revaluationDate: string;
  reversalDate: string;
  baseCurrency: string;
  totalGain: number;
  totalLoss: number;
  journalId: string;
  reversalJournalId: string;
  lineCount: number;
};

type RateRow = {
  rateId: string;
  rateDate: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: string;
  notes: string;
  createdBy: string;
  updatedAt: string;
};

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function ExchangeRatesClient() {
  const [baseCurrency, setBaseCurrency] = useState("PGK");
  const [rates, setRates] = useState<RateRow[]>([]);
  const [revaluations, setRevaluations] = useState<RevaluationRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [response, revaluationResponse] = await Promise.all([
        fetch("/api/erp/exchange-rates", { cache: "no-store" }),
        fetch("/api/erp/fx-revaluation", { cache: "no-store" }),
      ]);
      const [body, revaluationBody] = await Promise.all([
        response.json(),
        revaluationResponse.json(),
      ]);
      if (!response.ok || !body.ok) throw new Error(body.error || "Exchange rates could not be loaded");
      if (!revaluationResponse.ok || !revaluationBody.ok) throw new Error(revaluationBody.error || "FX revaluation history could not be loaded");
      setBaseCurrency(body.baseCurrency || "PGK");
      setRates(body.rates || []);
      setRevaluations(revaluationBody.revaluations || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exchange rates could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("Saving controlled exchange rate…");
    const form = event.currentTarget;
    try {
      const data = new FormData(form);
      const response = await fetch("/api/erp/exchange-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateDate: data.get("rateDate"),
          fromCurrency: String(data.get("fromCurrency") || "").toUpperCase(),
          toCurrency: String(data.get("toCurrency") || baseCurrency).toUpperCase(),
          rate: data.get("rate"),
          source: data.get("source"),
          notes: data.get("notes"),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Exchange rate save failed");
      setMessage(
        `Saved: 1 ${body.rate.fromCurrency} = ${body.rate.rate} ${body.rate.toCurrency} for ${body.rate.rateDate}`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exchange rate save failed");
    } finally {
      setSaving(false);
    }
  }


  async function postRevaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const date = String(data.get("revaluationDate") || "");
    if (!window.confirm(`Post foreign currency revaluation for ${date}? The system will also create an automatic reversal dated the following day.`)) return;
    setSaving(true);
    setMessage("Posting foreign currency revaluation…");
    try {
      const response = await fetch("/api/erp/fx-revaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revaluationDate: date }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "FX revaluation failed");
      if (body.result.noAdjustmentRequired) {
        setMessage("No foreign currency revaluation adjustment was required for that date.");
      } else {
        setMessage(
          `FX revaluation ${body.result.revaluationCode} posted · Gain ${body.result.totalGain.toFixed(2)} ${body.result.baseCurrency} · Loss ${body.result.totalLoss.toFixed(2)} ${body.result.baseCurrency} · reversal ${body.result.reversalDate}`,
        );
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "FX revaluation failed");
    } finally {
      setSaving(false);
    }
  }

  return <div>
    <div className="page-head">
      <div>
        <h2>Exchange Rates</h2>
        <p className="small">
          Controlled historical FX rates used by accounting documents. General Ledger stays in the company base currency.
        </p>
      </div>
      <div className="page-head-actions">
        <Link className="button-link secondary-link" href="/settings">← Finance Settings</Link>
        <span className="badge">BASE {baseCurrency}</span>
      </div>
    </div>

    {message && <div className="status-banner" style={{ marginBottom: 16 }}>{message}</div>}

    <section className="panel">
      <div className="form-title-row">
        <div>
          <h3>Rate Convention</h3>
          <p className="small">
            Enter the number of base/target currency units equal to one unit of the foreign/source currency.
            Example: if 1 USD = 4.05 PGK, From = USD, To = PGK, Rate = 4.05.
          </p>
        </div>
        <span className="auto-badge">HISTORICAL RATE CONTROL</span>
      </div>
    </section>

    <form className="panel form-grid" onSubmit={save} style={{ marginTop: 16 }}>
      <h3 className="form-title">Add / Update Exchange Rate</h3>
      <label>Rate Date<input name="rateDate" type="date" defaultValue={localDate()} required disabled={saving} /></label>
      <label>From Currency<input name="fromCurrency" maxLength={3} placeholder="USD" required disabled={saving} /></label>
      <label>To Currency<input name="toCurrency" maxLength={3} defaultValue={baseCurrency} required disabled={saving} /></label>
      <label>Rate<input name="rate" type="number" min="0.00000001" step="0.00000001" placeholder="4.05000000" required disabled={saving} /></label>
      <label>Source<input name="source" placeholder="Manual / Bank quote / approved source" defaultValue="MANUAL" disabled={saving} /></label>
      <label className="form-wide">Notes<input name="notes" placeholder="Optional reference, rate sheet, bank advice or approval note" disabled={saving} /></label>
      <div className="form-wide"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Exchange Rate"}</button></div>
    </form>

    <section className="panel table-wrap" style={{ marginTop: 16 }}>
      <div className="form-title-row">
        <div><h3>Historical Exchange Rate Register</h3><p className="small">Newest rates appear first. Re-saving the same date/currency pair updates that controlled rate.</p></div>
        <span className="auto-badge">{loading ? "Loading…" : `${rates.length} Rates`}</span>
      </div>
      <table className="data-table" style={{ minWidth: 980 }}>
        <thead><tr><th>Date</th><th>From</th><th>To</th><th>Rate</th><th>Meaning</th><th>Source</th><th>Notes</th></tr></thead>
        <tbody>
          {!rates.length && <tr><td colSpan={7}>No foreign exchange rates recorded yet.</td></tr>}
          {rates.map((row) => <tr key={row.rateId}>
            <td>{row.rateDate}</td>
            <td><strong>{row.fromCurrency}</strong></td>
            <td><strong>{row.toCurrency}</strong></td>
            <td>{Number(row.rate).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}</td>
            <td>1 {row.fromCurrency} = {row.rate} {row.toCurrency}</td>
            <td>{row.source || "MANUAL"}</td>
            <td>{row.notes || "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </section>

    <form className="panel form-grid" onSubmit={postRevaluation} style={{ marginTop: 16 }}>
      <div className="form-wide form-title-row">
        <div>
          <h3>Period-End FX Revaluation</h3>
          <p className="small">
            Remeasure open foreign-currency receivables and payables at the closing rate. The system posts unrealized FX gain/loss in base currency and creates an automatic reversal on the next day.
          </p>
        </div>
        <span className="auto-badge">CONTROLLER POSTING</span>
      </div>
      <label>Closing Date<input name="revaluationDate" type="date" defaultValue={localDate()} required disabled={saving} /></label>
      <div className="form-wide">
        <button type="submit" disabled={saving}>{saving ? "Posting…" : "Post FX Revaluation + Auto Reversal"}</button>
      </div>
    </form>

    <section className="panel table-wrap" style={{ marginTop: 16 }}>
      <div className="form-title-row">
        <div><h3>FX Revaluation History</h3><p className="small">Both closing journal and automatic next-day reversal remain auditable.</p></div>
        <span className="auto-badge">{revaluations.length} Batches</span>
      </div>
      <table className="data-table" style={{ minWidth: 1050 }}>
        <thead><tr><th>Batch</th><th>Closing Date</th><th>Reversal Date</th><th>Documents</th><th>Gain</th><th>Loss</th><th>Closing Journal</th><th>Reversal Journal</th></tr></thead>
        <tbody>
          {!revaluations.length && <tr><td colSpan={8}>No FX revaluation batches posted.</td></tr>}
          {revaluations.map((row) => <tr key={row.revaluationId}>
            <td><strong>{row.revaluationCode}</strong></td>
            <td>{row.revaluationDate}</td>
            <td>{row.reversalDate}</td>
            <td>{row.lineCount}</td>
            <td>{row.totalGain.toFixed(2)} {row.baseCurrency}</td>
            <td>{row.totalLoss.toFixed(2)} {row.baseCurrency}</td>
            <td><Link href={`/journals/${encodeURIComponent(row.journalId)}`}>{row.journalId}</Link></td>
            <td><Link href={`/journals/${encodeURIComponent(row.reversalJournalId)}`}>{row.reversalJournalId}</Link></td>
          </tr>)}
        </tbody>
      </table>
    </section>
  </div>;
}
