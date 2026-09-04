"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Item = { itemId: string; itemCode: string; itemName: string; itemType: string; defaultRate: number | string };
type Movement = { movementId: string; movementDate: string; itemId: string; projectId: string; movementType: string; qtyIn: number | string; qtyOut: number | string; unitCost: number | string; value: number | string; sourceDocumentId: string };
type Project = { projectId: string; projectName: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;

export default function StockPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [s, m] = await Promise.all([
        fetch("/api/stock", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/masters", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!s.ok) throw new Error(s.error || "Stock load failed");
      if (!m.ok) throw new Error(m.error || "Project load failed");
      setItems(s.items || []);
      setMovements(s.movements || []);
      setProjects(m.projects || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }

  useEffect(() => { void load(); }, []);

  const stock = useMemo(() => items.map((item) => {
    const rows = movements.filter((movement) => movement.itemId === item.itemId);
    const qty = rows.reduce((sum, movement) => sum + n(movement.qtyIn) - n(movement.qtyOut), 0);
    const value = rows.reduce((sum, movement) => sum + (n(movement.qtyIn) ? n(movement.value) : -n(movement.value)), 0);
    return { ...item, qty, value };
  }), [items, movements]);

  async function post(action: "createItem" | "createMovement", record: Record<string, FormDataEntryValue>) {
    const response = await fetch("/api/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action, record }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
    setMessage(`${action} saved: ${body.row.itemId || body.row.movementId}`);
    await load();
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await post("createItem", Object.fromEntries(new FormData(event.currentTarget).entries())); event.currentTarget.reset(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Item save failed"); }
  }

  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await post("createMovement", Object.fromEntries(new FormData(event.currentTarget).entries())); event.currentTarget.reset(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Movement save failed"); }
  }

  return (
    <>
      <h2>Items & Stock</h2>
      <p className="small">Track project materials and purchase receipts. Purchase receipt movements provide the receipt leg for PO matching.</p>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      <form className="panel form-grid" onSubmit={saveItem}>
        <h3 className="form-title">New Item</h3>
        <label>Item ID<input name="itemId" placeholder="Optional" /></label>
        <label>Item Code<input name="itemCode" required /></label>
        <label>Item Name<input name="itemName" required /></label>
        <label>Type<select name="itemType" defaultValue="STOCK"><option>STOCK</option><option>SERVICE</option><option>NON_STOCK</option></select></label>
        <label>Revenue Account<input name="revenueAccount" defaultValue="ACC-4200" /></label>
        <label>Cost Account<input name="costAccount" defaultValue="ACC-5100" /></label>
        <label>Default Rate<input name="defaultRate" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label>Tax Code<input name="taxCode" /></label>
        <div className="form-wide"><button type="submit">Save Item</button></div>
      </form>

      <form className="panel form-grid" onSubmit={saveMovement}>
        <h3 className="form-title">New Stock Movement / Goods Receipt</h3>
        <label>Date<input name="movementDate" type="date" required /></label>
        <label>Item<select name="itemId" required defaultValue=""><option value="" disabled>Select item</option>{items.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}</select></label>
        <label>Movement<select name="movementType" defaultValue="PURCHASE_RECEIPT"><option>PURCHASE_RECEIPT</option><option>PROJECT_ISSUE</option><option>ADJUSTMENT_IN</option><option>ADJUSTMENT_OUT</option><option>RETURN_IN</option><option>RETURN_OUT</option></select></label>
        <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></label>
        <label>Quantity<input name="qty" type="number" min="0.0001" step="0.0001" required /></label>
        <label>Unit Cost<input name="unitCost" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label>Source Document ID<input name="sourceDocumentId" placeholder="For PURCHASE_RECEIPT use PO ID" /></label>
        <div className="form-wide"><button type="submit">Save Movement</button></div>
      </form>

      <section className="panel table-wrap">
        <h3>Stock Balance</h3>
        <table className="data-table"><thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Book Value</th></tr></thead><tbody>{stock.map((row) => <tr key={row.itemId}><td>{row.itemCode} — {row.itemName}<br/><span className="small">{row.itemId}</span></td><td>{row.itemType}</td><td>{row.qty}</td><td>{money(row.value)}</td></tr>)}{!stock.length && <tr><td colSpan={4}>No items found.</td></tr>}</tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Movement Register</h3>
        <table className="data-table"><thead><tr><th>Date</th><th>Movement</th><th>Item</th><th>Project</th><th>Qty In</th><th>Qty Out</th><th>Value</th><th>Source</th></tr></thead><tbody>{[...movements].reverse().map((row) => <tr key={row.movementId}><td>{row.movementDate}</td><td>{row.movementType}</td><td>{row.itemId}</td><td>{row.projectId || "—"}</td><td>{row.qtyIn || 0}</td><td>{row.qtyOut || 0}</td><td>{money(row.value)}</td><td>{row.sourceDocumentId || "—"}</td></tr>)}</tbody></table>
      </section>
    </>
  );
}
