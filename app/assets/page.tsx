"use client";

import { FormEvent, useEffect, useState } from "react";

type Asset = {
  assetId: string;
  assetName: string;
  assetCategory: string;
  purchaseDate: string;
  supplierId: string;
  cost: number | string;
  serialNumber: string;
  location: string;
  assignedTo: string;
  usefulLifeMonths: number | string;
  status: string;
  sourceDocumentId: string;
  acquisitionJournalId?: string;
  depreciationJournalId?: string;
  journalId?: string;
};

type Supplier = {
  supplierId: string;
  supplierName: string;
};

const n = (v: unknown) => Number(v || 0);
const money = (v: unknown) => `K${n(v).toFixed(2)}`;

function monthsUsed(date: string, usefulLife: number) {
  const start = new Date(`${date}T00:00:00Z`);
  const now = new Date();
  if (Number.isNaN(start.getTime()) || now < start) return 0;
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, Math.min(usefulLife, months));
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [a, m] = await Promise.all([
        fetch("/api/assets").then((r) => r.json()),
        fetch("/api/masters").then((r) => r.json()),
      ]);
      if (!a.ok) throw new Error(a.error || "Asset load failed");
      if (!m.ok) throw new Error(m.error || "Supplier load failed");
      setAssets(a.assets || []);
      setSuppliers(m.suppliers || []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const r = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "assets", body: { record: Object.fromEntries(new FormData(e.currentTarget).entries()) } }),
      });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error || "Asset save failed");
      setMessage(`Asset ${b.row.assetId} created.`);
      e.currentTarget.reset();
      await load();
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Asset save failed");
    }
  }

  const totalCost = assets.reduce((sum, a) => sum + n(a.cost), 0);
  const totalDep = assets.reduce((sum, a) => {
    const life = Math.max(1, n(a.usefulLifeMonths));
    const used = monthsUsed(a.purchaseDate, life);
    return sum + Math.min(n(a.cost), (n(a.cost) / life) * used);
  }, 0);
  const totalNbv = Math.max(0, totalCost - totalDep);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Fixed Assets Register</h2>
          <p className="small">Asset tracking, straight-line depreciation estimates, and net book values (NBV).</p>
        </div>
        <div className="page-head-actions">
          {message && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Asset status:</strong> {message}
              </div>
            </details>
          )}
          <span className="badge">Asset Accounting</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Registered Assets</div>
          <div className="value">{assets.length}</div>
        </div>
        <div className="card">
          <div className="label">Total Original Cost</div>
          <div className="value">{money(totalCost)}</div>
        </div>
        <div className="card">
          <div className="label">Est. Accumulated Dep.</div>
          <div className="value">{money(totalDep)}</div>
        </div>
        <div className="card">
          <div className="label">Est. Net Book Value (NBV)</div>
          <div className="value">{money(totalNbv)}</div>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={submit}>
        <div className="form-wide form-title-row">
          <h3 className="form-title" style={{ margin: 0 }}>Register New Fixed Asset</h3>
          <span className="auto-badge">Capital Expenditure</span>
        </div>
        <label>
          Asset ID
          <input name="assetId" placeholder="Optional auto ID" />
        </label>
        <label>
          Asset Name
          <input name="assetName" required placeholder="e.g. Dell PowerEdge Server" />
        </label>
        <label>
          Category
          <input name="assetCategory" required placeholder="e.g. IT Equipment" />
        </label>
        <label>
          Purchase Date
          <input name="purchaseDate" type="date" required />
        </label>
        <label>
          Supplier
          <select name="supplierId" defaultValue="">
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>
                {s.supplierName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cost (PGK)
          <input name="cost" type="number" min="0" step="0.01" required />
        </label>
        <label>
          Serial Number
          <input name="serialNumber" placeholder="Serial / VIN" />
        </label>
        <label>
          Location
          <input name="location" placeholder="e.g. Data Center Rack 2" />
        </label>
        <label>
          Assigned To
          <input name="assignedTo" placeholder="Custodian / Department" />
        </label>
        <label>
          Useful Life (months)
          <input name="usefulLifeMonths" type="number" min="1" defaultValue="36" required />
        </label>
        <label>
          Source Document ID
          <input name="sourceDocumentId" required placeholder="Bill ID or PO ref" />
        </label>
        <div className="form-wide button-row">
          <button type="submit">Save Fixed Asset</button>
        </div>
      </form>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>Asset Ledger</h3>
          <span className="auto-badge">{assets.length} Assets Registered</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Category</th>
              <th>Purchase Date</th>
              <th>Original Cost</th>
              <th>Useful Life</th>
              <th>Est. Accum. Dep.</th>
              <th>Est. NBV</th>
              <th>Linked Journal</th>
              <th>Location</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const life = Math.max(1, n(asset.usefulLifeMonths));
              const used = monthsUsed(asset.purchaseDate, life);
              const monthly = n(asset.cost) / life;
              const dep = Math.min(n(asset.cost), monthly * used);
              const nbv = Math.max(0, n(asset.cost) - dep);
              return (
                <tr key={asset.assetId}>
                  <td>
                    <strong>{asset.assetName}</strong>
                    <br />
                    <span className="small">{asset.assetId}</span>
                  </td>
                  <td>{asset.assetCategory}</td>
                  <td>{asset.purchaseDate}</td>
                  <td>{money(asset.cost)}</td>
                  <td>{life} mo</td>
                  <td>{money(dep)}</td>
                  <td>
                    <strong>{money(nbv)}</strong>
                  </td>
                  <td>
                    <span className="small">{asset.depreciationJournalId || asset.acquisitionJournalId || asset.journalId || "—"}</span>
                  </td>
                  <td>{asset.location || "—"}</td>
                  <td>
                    <span className="auto-badge">{asset.status}</span>
                  </td>
                </tr>
              );
            })}
            {!assets.length && (
              <tr>
                <td colSpan={10}>No fixed assets found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
