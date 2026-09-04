"use client";

import { FormEvent, useEffect, useState } from "react";

type Setting = { key: string; value: string; notes: string };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Settings load failed");
      setSettings(body.settings || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          setting: { key: form.get("key"), value: form.get("value"), notes: form.get("notes") },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
      setMessage(`${body.row.key} ${body.action}.`);
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  const value = (key: string) => settings.find((row) => row.key === key)?.value || "";

  return (
    <>
      <h2>Finance Settings</h2>
      <p className="small">Controlled configuration for company, tax and banking information.</p>

      <div className="grid">
        <div className="card"><div className="label">Company</div><div className="value small-value">{value("company_name") || "—"}</div></div>
        <div className="card"><div className="label">Base Currency</div><div className="value">{value("base_currency") || "—"}</div></div>
        <div className="card"><div className="label">GST Status</div><div className="value small-value">{value("gst_status") || "UNVERIFIED"}</div></div>
        <div className="card"><div className="label">GST Number</div><div className="value small-value">{value("gst_number") || "—"}</div></div>
      </div>

      <section className="panel">
        <label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label>
      </section>

      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <form className="panel form-grid" onSubmit={save}>
        <h3 className="form-title">Update Setting</h3>
        <label>Setting
          <select name="key" required defaultValue="gst_status">
            <option value="company_name">Company Name</option>
            <option value="base_currency">Base Currency</option>
            <option value="financial_year_start_month">Financial Year Start Month</option>
            <option value="gst_status">GST Status</option>
            <option value="gst_number">GST Number</option>
            <option value="company_bank_name">Company Bank Name</option>
            <option value="company_bank_account">Company Bank Account</option>
            <option value="company_bank_bsb">Company Bank BSB</option>
          </select>
        </label>
        <label>Value<input name="value" required placeholder="For GST: UNVERIFIED / VERIFIED / NOT_REGISTERED" /></label>
        <label className="form-wide">Evidence / Notes<textarea name="notes" rows={3} placeholder="GST VERIFIED requires evidence/reference note" /></label>
        <div className="form-wide"><button type="submit">Save Setting</button></div>
      </form>

      <section className="panel table-wrap">
        <h3>Current Settings</h3>
        <table className="data-table"><thead><tr><th>Key</th><th>Value</th><th>Notes</th><th>Updated</th></tr></thead><tbody>
          {settings.map((row: any) => <tr key={row.key}><td>{row.key}</td><td>{row.value}</td><td>{row.notes || "—"}</td><td>{row.updatedAt || "—"}</td></tr>)}
        </tbody></table>
      </section>
    </>
  );
}
