"use client";

import { FormEvent, useEffect, useState } from "react";

type Asset = { assetId: string; assetName: string; assetCategory: string; purchaseDate: string; supplierId: string; cost: number | string; serialNumber: string; location: string; assignedTo: string; usefulLifeMonths: number | string; status: string; sourceDocumentId: string };
type Supplier = { supplierId: string; supplierName: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;

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
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [a, m] = await Promise.all([
        fetch("/api/assets", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/masters", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!a.ok) throw new Error(a.error || "Asset load failed");
      if (!m.ok) throw new Error(m.error || "Supplier load failed");
      setAssets(a.assets || []);
      setSuppliers(m.suppliers || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, record: Object.fromEntries(new FormData(event.currentTarget).entries()) }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Asset save failed");
      setMessage(`Asset ${body.row.assetId} created.`);
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Asset save failed");
    }
  }

  return (
    <>
      <h2>Fixed Assets</h2>
      <p className="small">Asset register with management straight-line depreciation estimate. Formal depreciation posting remains a Finance Controller action.</p>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <form className="panel form-grid" onSubmit={submit}>
        <h3 className="form-title">New Fixed Asset</h3>
        <label>Asset ID<input name="assetId" placeholder="Optional" /></label>
        <label>Asset Name<input name="assetName" required /></label>
        <label>Category<input name="assetCategory" required placeholder="Computer / Network / Office" /></label>
        <label>Purchase Date<input name="purchaseDate" type="date" required /></label>
        <label>Supplier<select name="supplierId" defaultValue=""><option value="">No supplier</option>{suppliers.map((s) => <option key={s.supplierId} value={s.supplierId}>{s.supplierName}</option>)}</select></label>
        <label>Cost<input name="cost" type="number" min="0" step="0.01" required /></label>
        <label>Serial Number<input name="serialNumber" /></label>
        <label>Location<input name="location" /></label>
        <label>Assigned To<input name="assignedTo" /></label>
        <label>Useful Life (months)<input name="usefulLifeMonths" type="number" min="1" defaultValue="36" required /></label>
        <label>Source Document ID<input name="sourceDocumentId" placeholder="Required retained DOC-..." required /></label>
        <div className="form-wide"><button type="submit">Save Asset</button></div>
      </form>

      <section className="panel table-wrap">
        <table className="data-table"><thead><tr><th>Asset</th><th>Category</th><th>Purchase</th><th>Cost</th><th>Life</th><th>Est. Accum. Dep.</th><th>Est. NBV</th><th>Location</th><th>Status</th></tr></thead><tbody>
          {assets.map((asset) => {
            const life = Math.max(1, n(asset.usefulLifeMonths));
            const used = monthsUsed(asset.purchaseDate, life);
            const monthly = n(asset.cost) / life;
            const dep = Math.min(n(asset.cost), monthly * used);
            const nbv = Math.max(0, n(asset.cost) - dep);
            return <tr key={asset.assetId}><td>{asset.assetName}<br/><span className="small">{asset.assetId}{asset.serialNumber ? ` · ${asset.serialNumber}` : ""}</span></td><td>{asset.assetCategory}</td><td>{asset.purchaseDate}</td><td>{money(asset.cost)}</td><td>{life} mo</td><td>{money(dep)}</td><td>{money(nbv)}</td><td>{asset.location || "—"}</td><td>{asset.status}</td></tr>;
          })}
          {!assets.length && <tr><td colSpan={9}>No fixed assets found.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
