"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ViewMode = "menu" | "newItem" | "newMovement" | "items" | "movements";

type Item = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  defaultRate: number | string;
  revenueAccount?: string;
  costAccount?: string;
  taxCode?: string;
};

type Movement = {
  movementId: string;
  movementDate: string;
  itemId: string;
  projectId: string;
  movementType: string;
  qtyIn: number | string;
  qtyOut: number | string;
  unitCost: number | string;
  value: number | string;
  sourceDocumentId: string;
};

type Project = { projectId: string; projectName: string };

type StockRow = Item & {
  qty: number;
  value: number;
  movementCount: number;
  qtyIn: number;
  qtyOut: number;
};

const n = (v: unknown) => Number(v || 0);
const money = (v: unknown) => `K${n(v).toFixed(2)}`;

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

export default function StockPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("menu");
  const [selectedItemId, setSelectedItemId] = useState("");

  function syncUrl(nextMode: ViewMode, itemId = "") {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("view", nextMode);
    if (itemId) params.set("item", itemId);
    else params.delete("item");
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
  }

  function openMode(nextMode: ViewMode) {
    setMessage("");
    setSelectedItemId("");
    setMode(nextMode);
    syncUrl(nextMode);
  }

  function backToMenu() {
    openMode("menu");
  }

  function openItem(itemId: string) {
    setSelectedItemId(itemId);
    syncUrl("items", itemId);
  }

  function backToItemList() {
    setSelectedItemId("");
    syncUrl("items");
  }

  async function load() {
    setLoading(true);
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
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    const resolved: ViewMode = ["newItem", "newMovement", "items", "movements"].includes(String(requested))
      ? (requested as ViewMode)
      : "menu";
    const requestedItem = params.get("item") || "";
    setMode(resolved);
    setSelectedItemId(resolved === "items" ? requestedItem : "");
    syncUrl(resolved, resolved === "items" ? requestedItem : "");
    void load();
  }, []);

  const stock = useMemo<StockRow[]>(
    () =>
      items.map((item) => {
        const rows = movements.filter((movement) => movement.itemId === item.itemId);
        const qtyIn = rows.reduce((sum, movement) => sum + n(movement.qtyIn), 0);
        const qtyOut = rows.reduce((sum, movement) => sum + n(movement.qtyOut), 0);
        const qty = qtyIn - qtyOut;
        const value = rows.reduce(
          (sum, movement) => sum + (n(movement.qtyIn) ? n(movement.value) : -n(movement.value)),
          0,
        );
        return { ...item, qty, value, movementCount: rows.length, qtyIn, qtyOut };
      }),
    [items, movements],
  );

  const selectedItem = useMemo(
    () => stock.find((item) => item.itemId === selectedItemId) || null,
    [stock, selectedItemId],
  );

  const selectedMovements = useMemo(
    () =>
      selectedItemId
        ? [...movements]
            .filter((movement) => movement.itemId === selectedItemId)
            .reverse()
        : [],
    [movements, selectedItemId],
  );

  async function post(
    action: "createItem" | "createMovement",
    record: Record<string, FormDataEntryValue>,
  ) {
    const r = await fetch("/api/erp/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "stock", body: { action, record } }),
    });
    const b = await r.json();
    if (!r.ok || !b.ok) throw new Error(b.error || "Save failed");
    setMessage(`${action === "createItem" ? "Item" : "Stock movement"} saved: ${b.row.itemId || b.row.movementId}`);
    await load();
  }

  async function saveItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    try {
      await post("createItem", record);
      form.reset();
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Item save failed");
    }
  }

  async function saveMovement(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    try {
      await post("createMovement", record);
      form.reset();
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "Movement save failed");
    }
  }

  const selectedAverageCost = selectedItem && selectedItem.qty !== 0
    ? selectedItem.value / selectedItem.qty
    : 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Items & Stock</h2>
          <p className="small">Create items, receive or issue stock, inspect item-level stock details, and review the full movement register from separate workspaces.</p>
        </div>
      </div>

      {message && (
        <section className="panel status-banner">
          <strong>Status:</strong> {message}
        </section>
      )}

      {mode === "menu" && (
        <section className="panel">
          <div className="form-title-row">
            <div>
              <h3>Items & Stock</h3>
              <p className="small">Choose one workspace. Forms, item details and movement history stay separate so they do not compete on the same screen.</p>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
              marginTop: 18,
            }}
          >
            <button type="button" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("newItem")}>
              <strong style={{ display: "block", fontSize: 17 }}>New Item</strong>
              <span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Create a new stock, service or non-stock item.</span>
            </button>
            <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("newMovement")}>
              <strong style={{ display: "block", fontSize: 17 }}>New Stock Movement / Goods Receipt</strong>
              <span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Receive, issue, return or adjust stock quantities.</span>
            </button>
            <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("items")}>
              <strong style={{ display: "block", fontSize: 17 }}>Item & Stock Details</strong>
              <span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Browse item balances and click an item for its detailed stock view.</span>
            </button>
            <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("movements")}>
              <strong style={{ display: "block", fontSize: 17 }}>Movement Register</strong>
              <span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Open the complete stock movement history and source references.</span>
            </button>
          </div>
        </section>
      )}

      {mode !== "menu" && (
        <section className="panel">
          <div className="button-row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="secondary" onClick={backToMenu}>← Back to Items & Stock</button>
            <span className="auto-badge">
              {mode === "newItem" && "New Item"}
              {mode === "newMovement" && "New Stock Movement / Goods Receipt"}
              {mode === "items" && "Item & Stock Details"}
              {mode === "movements" && "Movement Register"}
            </span>
          </div>
        </section>
      )}

      {mode === "newItem" && (
        <form className="panel form-grid" onSubmit={saveItem}>
          <h3 className="form-title">New Item</h3>
          <label>Item ID<input name="itemId" placeholder="Optional / auto if supported" /></label>
          <label>Item Code<input name="itemCode" required /></label>
          <label>Item Name<input name="itemName" required /></label>
          <label>
            Type
            <select name="itemType" defaultValue="STOCK">
              <option>STOCK</option>
              <option>SERVICE</option>
              <option>NON_STOCK</option>
            </select>
          </label>
          <label>Revenue Account<input name="revenueAccount" defaultValue="ACC-4200" /></label>
          <label>Cost Account<input name="costAccount" defaultValue="ACC-5100" /></label>
          <label>Default Rate<input name="defaultRate" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Tax Code<input name="taxCode" /></label>
          <div className="form-wide button-row"><button type="submit">Save Item</button></div>
        </form>
      )}

      {mode === "newMovement" && (
        <form className="panel form-grid" onSubmit={saveMovement}>
          <h3 className="form-title">New Stock Movement / Goods Receipt</h3>
          <label>Date<input name="movementDate" type="date" required defaultValue={localDate()} /></label>
          <label>
            Item
            <select name="itemId" required defaultValue="">
              <option value="" disabled>Select item</option>
              {items.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Movement
            <select name="movementType" defaultValue="PURCHASE_RECEIPT">
              <option>PURCHASE_RECEIPT</option>
              <option>PROJECT_ISSUE</option>
              <option>ADJUSTMENT_IN</option>
              <option>ADJUSTMENT_OUT</option>
              <option>RETURN_IN</option>
              <option>RETURN_OUT</option>
            </select>
          </label>
          <label>
            Project
            <select name="projectId" defaultValue="">
              <option value="">No project</option>
              {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
            </select>
          </label>
          <label>Quantity<input name="qty" type="number" min="0.0001" step="0.0001" required /></label>
          <label>Unit Cost<input name="unitCost" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Source Document ID<input name="sourceDocumentId" /></label>
          <div className="form-wide button-row"><button type="submit">Save Movement</button></div>
        </form>
      )}

      {mode === "items" && !selectedItemId && (
        <section className="panel table-wrap">
          <div className="form-title-row">
            <div>
              <h3>Item & Stock Details</h3>
              <p className="small">Click any item to open its detailed stock card and movement history.</p>
            </div>
            <span className="auto-badge">{loading ? "Loading…" : `${stock.length} Items`}</span>
          </div>
          <table className="data-table">
            <thead><tr><th>Item</th><th>Type</th><th>Qty In</th><th>Qty Out</th><th>Balance Qty</th><th>Book Value</th><th>Movements</th><th>Action</th></tr></thead>
            <tbody>
              {!loading && stock.length === 0 && <tr><td colSpan={8}>No items found.</td></tr>}
              {stock.map((row) => (
                <tr key={row.itemId}>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: 0, border: 0, background: "transparent", textAlign: "left" }}
                      onClick={() => openItem(row.itemId)}
                    >
                      <strong>{row.itemCode}</strong><br /><span className="small">{row.itemName}</span>
                    </button>
                  </td>
                  <td>{row.itemType}</td>
                  <td>{row.qtyIn}</td>
                  <td>{row.qtyOut}</td>
                  <td><strong>{row.qty}</strong></td>
                  <td>{money(row.value)}</td>
                  <td>{row.movementCount}</td>
                  <td><button type="button" onClick={() => openItem(row.itemId)}>View Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {mode === "items" && selectedItemId && (
        <>
          <section className="panel">
            <div className="button-row" style={{ justifyContent: "space-between" }}>
              <button type="button" className="secondary" onClick={backToItemList}>← Back to Item & Stock Details</button>
              {selectedItem && <span className="auto-badge">{selectedItem.itemCode}</span>}
            </div>
          </section>

          {!selectedItem && !loading && (
            <section className="panel"><strong>Item not found.</strong></section>
          )}

          {selectedItem && (
            <>
              <section className="panel">
                <div className="form-title-row">
                  <div>
                    <h3>{selectedItem.itemName}</h3>
                    <p className="small">{selectedItem.itemCode} · {selectedItem.itemType}</p>
                  </div>
                  <span className="auto-badge">Item ID: {selectedItem.itemId}</span>
                </div>
                <div className="document-meta" style={{ marginTop: 18 }}>
                  <div><span>Balance Quantity</span><strong>{selectedItem.qty}</strong></div>
                  <div><span>Book Value</span><strong>{money(selectedItem.value)}</strong></div>
                  <div><span>Average Book Cost</span><strong>{money(selectedAverageCost)}</strong></div>
                  <div><span>Total Qty In</span><strong>{selectedItem.qtyIn}</strong></div>
                  <div><span>Total Qty Out</span><strong>{selectedItem.qtyOut}</strong></div>
                  <div><span>Movement Count</span><strong>{selectedItem.movementCount}</strong></div>
                  <div><span>Default Rate</span><strong>{money(selectedItem.defaultRate)}</strong></div>
                  <div><span>Revenue Account</span><strong>{selectedItem.revenueAccount || "—"}</strong></div>
                  <div><span>Cost Account</span><strong>{selectedItem.costAccount || "—"}</strong></div>
                  <div><span>Tax Code</span><strong>{selectedItem.taxCode || "—"}</strong></div>
                </div>
              </section>

              <section className="panel table-wrap">
                <div className="form-title-row"><h3>Item Movement History</h3><span className="auto-badge">{selectedMovements.length} Movements</span></div>
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Movement</th><th>Project</th><th>Qty In</th><th>Qty Out</th><th>Unit Cost</th><th>Value</th><th>Source</th></tr></thead>
                  <tbody>
                    {selectedMovements.length === 0 && <tr><td colSpan={8}>No movements recorded for this item.</td></tr>}
                    {selectedMovements.map((movement) => (
                      <tr key={movement.movementId}>
                        <td>{movement.movementDate}</td>
                        <td>{movement.movementType}</td>
                        <td>{movement.projectId || "—"}</td>
                        <td>{movement.qtyIn || 0}</td>
                        <td>{movement.qtyOut || 0}</td>
                        <td>{money(movement.unitCost)}</td>
                        <td>{money(movement.value)}</td>
                        <td>{movement.sourceDocumentId || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </>
      )}

      {mode === "movements" && (
        <section className="panel table-wrap">
          <div className="form-title-row">
            <div>
              <h3>Movement Register</h3>
              <p className="small">Complete stock movement history, newest first.</p>
            </div>
            <span className="auto-badge">{loading ? "Loading…" : `${movements.length} Movements`}</span>
          </div>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Movement</th><th>Item</th><th>Project</th><th>Qty In</th><th>Qty Out</th><th>Unit Cost</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>
              {!loading && movements.length === 0 && <tr><td colSpan={9}>No stock movements found.</td></tr>}
              {[...movements].reverse().map((movement) => {
                const item = items.find((row) => row.itemId === movement.itemId);
                return (
                  <tr key={movement.movementId}>
                    <td>{movement.movementDate}</td>
                    <td>{movement.movementType}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: 0, border: 0, background: "transparent", textAlign: "left" }}
                        onClick={() => {
                          setMode("items");
                          openItem(movement.itemId);
                        }}
                      >
                        <strong>{item?.itemCode || movement.itemId}</strong>{item?.itemName ? <><br /><span className="small">{item.itemName}</span></> : null}
                      </button>
                    </td>
                    <td>{movement.projectId || "—"}</td>
                    <td>{movement.qtyIn || 0}</td>
                    <td>{movement.qtyOut || 0}</td>
                    <td>{money(movement.unitCost)}</td>
                    <td>{money(movement.value)}</td>
                    <td>{movement.sourceDocumentId || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
