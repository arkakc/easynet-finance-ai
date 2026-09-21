"use client";

import { useEffect, useMemo, useState } from "react";

type CostCenter = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentCode: string;
  parentName: string;
  isGroup: boolean;
  isActive: boolean;
  description: string;
  childCount: number;
  display: string;
};

const emptyForm = { code: "", name: "", parentRef: "", description: "", isActive: true };

export default function CostCentersPage() {
  const [rows, setRows] = useState<CostCenter[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const response = await fetch("/api/cost-centers", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Cost Centers could not be loaded");
    setRows(body.costCenters || []);
  }

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Cost Centers could not be loaded")); }, []);

  const parentOptions = useMemo(() => rows.filter((row) => row.isActive && row.id !== editing?.id), [rows, editing]);
  const treeRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] as CostCenter[] }]));
    const roots: Array<CostCenter & { children: CostCenter[] }> = [];
    byId.forEach((row) => {
      const parent = row.parentId ? byId.get(row.parentId) : null;
      if (parent) parent.children.push(row);
      else roots.push(row);
    });
    const flatten = (items: Array<CostCenter & { children: CostCenter[] }>, level = 0): Array<CostCenter & { level: number }> => items
      .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }))
      .flatMap((row) => [{ ...row, level }, ...flatten(row.children as Array<CostCenter & { children: CostCenter[] }>, level + 1)]);
    return flatten(roots);
  }, [rows]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = editing ? { id: editing.id, ...form } : form;
      const response = await fetch("/api/cost-centers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Cost Center save failed");
      setMessage(editing ? "Cost Center updated." : "Cost Center created.");
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cost Center save failed");
    } finally {
      setBusy(false);
    }
  }

  function edit(row: CostCenter) {
    setEditing(row);
    setForm({ code: row.code, name: row.name, parentRef: row.parentCode || "", description: row.description || "", isActive: row.isActive });
  }

  return <div className="page-stack">
    <section className="page-header">
      <div>
        <span className="badge">Accounting master</span>
        <h1>Cost Centers</h1>
        <p>Maintain Easynet-style Cost Center master records. P&L journal lines can now carry a validated cost center for reporting.</p>
      </div>
      <span className="coa-status-pill valid">{rows.length} centers</span>
    </section>

    {(error || message) && <section className={error ? "warning-panel" : "panel"}><strong>{error ? "Action required" : "Saved"}</strong><p className="small">{error || message}</p></section>}

    <form className="panel form-grid" onSubmit={save}>
      <div className="form-wide form-title-row">
        <div>
          <h2>{editing ? "Edit Cost Center" : "New Cost Center"}</h2>
          <p className="small">Use a stable code like Main, Sales, Admin, Projects, or Branch-POM. Parent makes a reporting tree.</p>
        </div>
        {editing && <button type="button" className="secondary-btn" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancel edit</button>}
      </div>
      <label>Code<input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} readOnly={Boolean(editing)} placeholder="Main" /></label>
      <label>Name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Main" /></label>
      <label>Parent Cost Center<input list="cost-center-parent-options" value={form.parentRef} onChange={(event) => setForm((current) => ({ ...current, parentRef: event.target.value }))} placeholder="Optional parent" /><datalist id="cost-center-parent-options">{parentOptions.map((row) => <option key={row.id} value={row.display}>{row.display}</option>)}</datalist></label>
      <label>Status<select value={form.isActive ? "active" : "inactive"} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "active" }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label className="form-wide">Description<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional reporting purpose" /></label>
      <div className="form-wide button-row"><button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Update Cost Center" : "Create Cost Center"}</button></div>
    </form>

    <section className="panel table-wrap">
      <div className="form-title-row">
        <div>
          <h2>Cost Center Tree</h2>
          <p className="small">Main is seeded automatically. Group centers are parents; posting lines should use active leaf centers.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void load()} disabled={busy}>Refresh</button>
      </div>
      <table className="data-table" style={{ marginTop: 16 }}>
        <thead><tr><th>Code</th><th>Name</th><th>Parent</th><th>Status</th><th>Mode</th><th>Description</th><th>Action</th></tr></thead>
        <tbody>{treeRows.map((row) => <tr key={row.id}>
          <td style={{ paddingLeft: 12 + row.level * 20 }}><strong>{row.code}</strong></td>
          <td>{row.name}</td>
          <td>{row.parentCode ? `${row.parentCode} — ${row.parentName}` : "—"}</td>
          <td><span className={`coa-status-pill ${row.isActive ? "valid" : "invalid"}`}>{row.isActive ? "Active" : "Inactive"}</span></td>
          <td>{row.childCount > 0 || row.isGroup ? "Group" : "Leaf / posting"}</td>
          <td>{row.description || "—"}</td>
          <td><button type="button" className="secondary-btn" onClick={() => edit(row)}>Edit</button></td>
        </tr>)}</tbody>
      </table>
    </section>
  </div>;
}
