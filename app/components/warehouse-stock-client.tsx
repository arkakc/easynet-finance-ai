"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Warehouse = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  location?: string;
  isDefault?: boolean;
  active?: boolean;
};

type Item = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
};

type Balance = {
  balanceId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
  reserved: number;
  available: number;
  valuationRate: number;
  stockValue: number;
};

const qty = (value: unknown) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const money = (value: unknown) => \`K\${Number(value || 0).toFixed(2)}\`;

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return \`\${values.year}-\${values.month}-\${values.day}\`;
}

export default function WarehouseStockClient() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/stock", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Warehouse stock load failed");
      setWarehouses(body.warehouses || []);
      setItems((body.items || []).filter((item: Item) => String(item.itemType || "").toUpperCase() === "STOCK"));
      setBalances(body.warehouseBalances || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Warehouse stock load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function postStock(action: string, record: Record<string, unknown>) {
    const response = await fetch("/api/erp/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "stock", body: { action, record } }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Warehouse action failed");
    await load();
    return body;
  }

  async function createWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("warehouse");
    try {
      const form = new FormData(event.currentTarget);
      const body = await postStock("createWarehouse", {
        code: form.get("code"),
        name: form.get("name"),
        location: form.get("location"),
        isDefault: form.get("isDefault") === "on",
      });
      setMessage(\`Warehouse created: \${body.warehouse.warehouseCode} — \${body.warehouse.warehouseName}\`);
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Warehouse creation failed");
    } finally {
      setBusy("");
    }
  }

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("transfer");
    try {
      const form = new FormData(event.currentTarget);
      const body = await postStock("createTransfer", {
        movementDate: form.get("movementDate"),
        itemId: form.get("itemId"),
        fromWarehouseId: form.get("fromWarehouseId"),
        toWarehouseId: form.get("toWarehouseId"),
        qty: form.get("qty"),
        sourceDocumentId: form.get("sourceDocumentId"),
        note: form.get("note"),
      });
      const result = body.transfer;
      setMessage(
        \`Transfer \${result.transferId} posted: \${qty(result.quantity)} \${result.itemCode} · \${result.fromWarehouse.code} → \${result.toWarehouse.code} · no GL entry required.\`,
      );
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Warehouse transfer failed");
    } finally {
      setBusy("");
    }
  }

  const totalValue = useMemo(
    () => balances.reduce((sum, row) => sum + Number(row.stockValue || 0), 0),
    [balances],
  );
  const totalQty = useMemo(
    () => balances.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    [balances],
  );

  return <div>
    <div className="page-head">
      <div>
        <h2>Warehouse Stock</h2>
        <p className="small">
          Item-by-warehouse stock, moving-average valuation, warehouse transfers and perpetual stock audit trail.
        </p>
      </div>
      <div className="page-head-actions">
        <Link className="button-link secondary-link" href="/stock">← Items & Stock</Link>
        <span className="badge">WAREHOUSE CONTROL</span>
      </div>
    </div>

    {message && <div className="status-banner" style={{ marginBottom: 16 }}>{message}</div>}

    <div className="grid">
      <div className="card"><div className="label">Active Warehouses</div><div className="value">{warehouses.length}</div></div>
      <div className="card"><div className="label">Warehouse Balance Rows</div><div className="value">{balances.length}</div></div>
      <div className="card"><div className="label">Total Stock Qty</div><div className="value">{qty(totalQty)}</div></div>
      <div className="card"><div className="label">Inventory Book Value</div><div className="value">{money(totalValue)}</div></div>
    </div>

    <section className="panel table-wrap" style={{ marginTop: 20 }}>
      <div className="form-title-row">
        <div>
          <h3>Warehouse Master</h3>
          <p className="small">Every physical stock movement belongs to an active warehouse. One warehouse is the controlled default.</p>
        </div>
        <span className="auto-badge">{loading ? "Loading…" : \`\${warehouses.length} Warehouses\`}</span>
      </div>
      <table className="data-table">
        <thead><tr><th>Code</th><th>Warehouse</th><th>Location</th><th>Default</th><th>Status</th></tr></thead>
        <tbody>
          {!warehouses.length && <tr><td colSpan={5}>No warehouse master rows.</td></tr>}
          {warehouses.map((warehouse) => <tr key={warehouse.warehouseId}>
            <td><strong>{warehouse.warehouseCode}</strong></td>
            <td>{warehouse.warehouseName}</td>
            <td>{warehouse.location || "—"}</td>
            <td>{warehouse.isDefault ? "YES" : "—"}</td>
            <td>{warehouse.active === false ? "INACTIVE" : "ACTIVE"}</td>
          </tr>)}
        </tbody>
      </table>
    </section>

    <form className="panel form-grid" onSubmit={createWarehouse} style={{ marginTop: 20 }}>
      <h3 className="form-title">Create Warehouse</h3>
      <label>Warehouse Code<input name="code" placeholder="POM" required disabled={Boolean(busy)} /></label>
      <label>Warehouse Name<input name="name" placeholder="Port Moresby Warehouse" required disabled={Boolean(busy)} /></label>
      <label>Location<input name="location" placeholder="Optional physical location" disabled={Boolean(busy)} /></label>
      <label><span>Default Warehouse</span><input name="isDefault" type="checkbox" disabled={Boolean(busy)} /></label>
      <div className="form-wide"><button type="submit" disabled={Boolean(busy)}>{busy === "warehouse" ? "Creating…" : "Create Warehouse"}</button></div>
    </form>

    <section className="panel table-wrap" style={{ marginTop: 20 }}>
      <div className="form-title-row">
        <div>
          <h3>Stock by Warehouse</h3>
          <p className="small">Quantity, available quantity, warehouse moving-average cost and book value.</p>
        </div>
      </div>
      <table className="data-table" style={{ minWidth: 1050 }}>
        <thead><tr><th>Warehouse</th><th>Item</th><th>Qty</th><th>Reserved</th><th>Available</th><th>Avg Cost</th><th>Book Value</th></tr></thead>
        <tbody>
          {!balances.length && <tr><td colSpan={7}>No warehouse stock balances yet.</td></tr>}
          {balances.map((row) => <tr key={row.balanceId}>
            <td><strong>{row.warehouseCode}</strong><br /><span className="small">{row.warehouseName}</span></td>
            <td><Link href={\`/stock/item/\${encodeURIComponent(row.itemId)}\`}><strong>{row.itemCode}</strong></Link><br /><span className="small">{row.itemName}</span></td>
            <td>{qty(row.quantity)}</td>
            <td>{qty(row.reserved)}</td>
            <td><strong>{qty(row.available)}</strong></td>
            <td>{money(row.valuationRate)}</td>
            <td><strong>{money(row.stockValue)}</strong></td>
          </tr>)}
        </tbody>
      </table>
    </section>

    <form className="panel form-grid" onSubmit={transfer} style={{ marginTop: 20 }}>
      <h3 className="form-title">Warehouse Transfer</h3>
      <label>Date<input name="movementDate" type="date" defaultValue={localDate()} required disabled={Boolean(busy)} /></label>
      <label>Stock Item<select name="itemId" required defaultValue="" disabled={Boolean(busy)}><option value="">Select stock item</option>{items.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}</select></label>
      <label>From Warehouse<select name="fromWarehouseId" required defaultValue="" disabled={Boolean(busy)}><option value="">Select source</option>{warehouses.map((warehouse) => <option key={warehouse.warehouseId} value={warehouse.warehouseId}>{warehouse.warehouseCode} — {warehouse.warehouseName}</option>)}</select></label>
      <label>To Warehouse<select name="toWarehouseId" required defaultValue="" disabled={Boolean(busy)}><option value="">Select destination</option>{warehouses.map((warehouse) => <option key={warehouse.warehouseId} value={warehouse.warehouseId}>{warehouse.warehouseCode} — {warehouse.warehouseName}</option>)}</select></label>
      <label>Quantity<input name="qty" type="number" min="0.0001" step="0.0001" required disabled={Boolean(busy)} /></label>
      <label>Source / Reference<input name="sourceDocumentId" placeholder="Optional transfer request / memo" disabled={Boolean(busy)} /></label>
      <label className="form-wide">Note<input name="note" placeholder="Optional transfer note" disabled={Boolean(busy)} /></label>
      <div className="form-wide">
        <p className="small">Internal warehouse transfer moves quantity and book value between locations. Because ownership and the inventory GL account do not change, no General Ledger journal is created.</p>
        <button type="submit" disabled={Boolean(busy) || warehouses.length < 2}>{busy === "transfer" ? "Transferring…" : "Post Warehouse Transfer"}</button>
      </div>
    </form>
  </div>;
}
