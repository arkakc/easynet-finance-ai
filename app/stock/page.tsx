"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "menu" | "newItem" | "movement" | "details" | "register";

type Item = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  revenueAccount?: string;
  costAccount?: string;
  defaultRate: number | string;
  taxCode?: string;
  stockQty?: number | string;
  stockValue?: number | string;
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
type PurchaseOrder = {
  poId: string;
  poNumber: string;
  supplierId: string;
  projectId: string;
  status: string;
  totalAmount: number | string;
};
type POLine = {
  poLineId: string;
  poId: string;
  itemId?: string;
  description?: string;
  qty: number | string;
  rate: number | string;
};

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;
const qtyText = (value: unknown) => n(value).toLocaleString(undefined, { maximumFractionDigits: 4 });

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

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function lineMatchesItem(line: POLine, item: Item) {
  const itemId = String(item.itemId || "");
  const itemCode = String(item.itemCode || itemId);
  const lineItem = String(line.itemId || "");
  if (lineItem && (lineItem === itemId || lineItem === itemCode)) return true;

  const description = normalized(line.description);
  const code = normalized(itemCode);
  const name = normalized(item.itemName);
  if (!description) return false;
  if (code && (description === code || description.includes(code))) return true;
  if (name && name.length >= 4 && (description === name || description.includes(name))) return true;
  return false;
}

function weightedRate(lines: POLine[]) {
  const totalQty = lines.reduce((sum, line) => sum + n(line.qty), 0);
  if (!(totalQty > 0)) return 0;
  return lines.reduce((sum, line) => sum + n(line.qty) * n(line.rate), 0) / totalQty;
}

export default function StockPage() {
  const [mode, setMode] = useState<Mode>("menu");
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [poLines, setPoLines] = useState<POLine[]>([]);
  const [nextItemCode, setNextItemCode] = useState("Loading…");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedMovementId, setSelectedMovementId] = useState("");
  const [movementType, setMovementType] = useState("PURCHASE_RECEIPT");
  const [sourcePoId, setSourcePoId] = useState("");
  const [movementItemId, setMovementItemId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [stockResponse, masterResponse] = await Promise.all([
        fetch("/api/stock", { cache: "no-store" }).then((response) => response.json()),
        fetch("/api/masters", { cache: "no-store" }).then((response) => response.json()),
      ]);
      if (!stockResponse.ok) throw new Error(stockResponse.error || "Stock load failed");
      if (!masterResponse.ok) throw new Error(masterResponse.error || "Project load failed");
      setItems(stockResponse.items || []);
      setMovements(stockResponse.movements || []);
      setPurchaseOrders(stockResponse.purchaseOrders || []);
      setPoLines(stockResponse.poLines || []);
      setNextItemCode(stockResponse.nextItemCode || "AUTO");
      setProjects(masterResponse.projects || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const stock = useMemo(() => items.map((item) => {
    const rows = movements.filter((movement) => movement.itemId === item.itemId);
    const qtyIn = rows.reduce((sum, movement) => sum + n(movement.qtyIn), 0);
    const qtyOut = rows.reduce((sum, movement) => sum + n(movement.qtyOut), 0);
    const qty = n(item.stockQty ?? qtyIn - qtyOut);
    const value = n(item.stockValue ?? rows.reduce((sum, movement) => sum + (n(movement.qtyIn) > 0 ? n(movement.value) : -n(movement.value)), 0));
    return { ...item, qtyIn, qtyOut, qty, value, movementCount: rows.length };
  }), [items, movements]);

  const stockItems = useMemo(() => items.filter((item) => String(item.itemType || "").toUpperCase() === "STOCK"), [items]);

  const approvedPurchaseOrders = useMemo(() => purchaseOrders.filter((po) => {
    const status = String(po.status || "").toUpperCase();
    const number = String(po.poNumber || "").toUpperCase();
    return !number.startsWith("SUPQ-") && ["APPROVED", "PART_RECEIVED", "RECEIVED", "BILL_CREATED", "BILLED"].includes(status);
  }), [purchaseOrders]);

  const selectedPo = useMemo(() => purchaseOrders.find((po) => po.poId === sourcePoId) || null, [purchaseOrders, sourcePoId]);
  const selectedPoLines = useMemo(() => poLines.filter((line) => line.poId === sourcePoId), [poLines, sourcePoId]);

  const receiptEligibleItems = useMemo(() => {
    if (movementType !== "PURCHASE_RECEIPT" || !sourcePoId) return stockItems;
    const matched = stockItems.filter((item) => selectedPoLines.some((line) => lineMatchesItem(line, item)));
    return matched.length ? matched : stockItems;
  }, [movementType, sourcePoId, selectedPoLines, stockItems]);

  const selectedMovementItem = useMemo(() => items.find((item) => item.itemId === movementItemId) || null, [items, movementItemId]);
  const purchaseReceiptRate = useMemo(() => {
    if (movementType !== "PURCHASE_RECEIPT" || !selectedMovementItem) return 0;
    return weightedRate(selectedPoLines.filter((line) => lineMatchesItem(line, selectedMovementItem)));
  }, [movementType, selectedMovementItem, selectedPoLines]);

  const isIncomingManualCost = movementType === "ADJUSTMENT_IN" || movementType === "RETURN_IN";
  const autoMovementRate = movementType === "PURCHASE_RECEIPT"
    ? purchaseReceiptRate
    : !["PURCHASE_RECEIPT", "ADJUSTMENT_IN", "RETURN_IN"].includes(movementType)
      ? n(selectedMovementItem?.defaultRate)
      : null;

  const selectedItem = useMemo(() => stock.find((item) => item.itemId === selectedItemId) || null, [stock, selectedItemId]);
  const selectedMovement = useMemo(() => movements.find((movement) => movement.movementId === selectedMovementId) || null, [movements, selectedMovementId]);

  const movementRates = useMemo(() => {
    const map = new Map<string, number>();
    const states = new Map<string, { qty: number; value: number; rate: number }>();
    for (const movement of movements) {
      const current = states.get(movement.itemId) || { qty: 0, value: 0, rate: 0 };
      const incoming = n(movement.qtyIn) > 0;
      const nextQty = current.qty + n(movement.qtyIn) - n(movement.qtyOut);
      const nextValue = current.value + (incoming ? n(movement.value) : -n(movement.value));
      const nextRate = nextQty > 0 ? nextValue / nextQty : current.rate || n(movement.unitCost);
      states.set(movement.itemId, { qty: nextQty, value: nextValue, rate: Math.max(0, nextRate) });
      map.set(movement.movementId, Math.max(0, nextRate));
    }
    return map;
  }, [movements]);

  const poMap = useMemo(() => new Map(purchaseOrders.map((po) => [po.poId, po])), [purchaseOrders]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.itemId, item])), [items]);

  async function post(action: "createItem" | "createMovement", record: Record<string, FormDataEntryValue>) {
    const response = await fetch("/api/erp/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "stock", body: { action, record } }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
    if (action === "createItem") {
      setMessage(`Item saved: ${body.row.itemCode || body.row.itemId}`);
    } else {
      const rate = body.valuation?.movingAverageRate;
      setMessage(`Movement saved: ${body.row.movementId}${rate !== undefined ? ` · Moving Average ${money(rate)}` : ""}`);
    }
    await load();
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    try {
      await post("createItem", record);
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Item save failed");
    }
  }

  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    try {
      await post("createMovement", record);
      form.reset();
      setSourcePoId("");
      setMovementItemId("");
      setMovementType("PURCHASE_RECEIPT");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Movement save failed");
    }
  }

  function openMode(nextMode: Mode) {
    setMode(nextMode);
    setSelectedMovementId("");
    setMessage("");
  }

  function openItem(itemId: string) {
    setSelectedItemId(itemId);
    setSelectedMovementId("");
    setMode("details");
  }

  function openMovement(movementId: string) {
    setSelectedMovementId(movementId);
    setMode("register");
  }

  const sourceLink = (movement: Movement) => {
    if (!movement.sourceDocumentId) return <span>—</span>;
    const po = poMap.get(movement.sourceDocumentId);
    if (po) {
      return <Link prefetch={false} target="_blank" href={`/transactions/purchaseOrder/${encodeURIComponent(po.poId)}`}><strong>{po.poNumber || po.poId}</strong></Link>;
    }
    return <span>{movement.sourceDocumentId}</span>;
  };

  return <>
    <div className="page-heading">
      <div><h2>Items & Stock</h2><p className="small">Item master, stock receipt, valuation and traceability are kept in separate workspaces.</p></div>
    </div>

    {message && <section className="panel status-banner"><strong>Status:</strong> {message}</section>}

    {mode === "menu" && <section className="panel">
      <h3>Items & Stock</h3>
      <p className="small">Choose one workspace. Forms, stock balances and movement history stay separate.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16, marginTop: 20 }}>
        <button type="button" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("newItem")}><strong style={{ display: "block", fontSize: 17 }}>New Item</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Create a Stock, Service or Non-Stock item with an automatic Item Code.</span></button>
        <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("movement")}><strong style={{ display: "block", fontSize: 17 }}>New Stock Movement / Goods Receipt</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Receive against a PO or record stock issues, returns and adjustments.</span></button>
        <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("details")}><strong style={{ display: "block", fontSize: 17 }}>Item & Stock Details</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Open an item tile to review quantity, moving-average rate, value and linked purchase history.</span></button>
        <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("register")}><strong style={{ display: "block", fontSize: 17 }}>Movement Register</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Review every receipt, issue, return and adjustment with source-document tracking.</span></button>
      </div>
    </section>}

    {mode !== "menu" && <section className="panel"><div className="button-row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={() => { setMode("menu"); setSelectedItemId(""); setSelectedMovementId(""); }}>← Back to Items & Stock</button><span className="auto-badge">{loading ? "Loading…" : `${items.length} Items · ${movements.length} Movements`}</span></div></section>}

    {mode === "newItem" && <form className="panel form-grid" onSubmit={saveItem}>
      <h3 className="form-title">New Item</h3>
      <label>Item Code<input value={nextItemCode || "AUTO"} readOnly /><span className="small">Auto-generated. Item ID and Item Code are now the same value.</span></label>
      <label>Item Name<input name="itemName" required /></label>
      <label>Type<select name="itemType" defaultValue="STOCK"><option>STOCK</option><option>SERVICE</option><option>NON_STOCK</option></select></label>
      <label>Revenue Account<input name="revenueAccount" defaultValue="ACC-4200" /></label>
      <label>Cost Account<input name="costAccount" defaultValue="ACC-5100" /></label>
      <label>Moving Average Rate<input value="0.00" readOnly /><span className="small">Read-only. STOCK valuation is calculated automatically from PO-linked purchase receipts.</span></label>
      <label>Tax Code<input name="taxCode" /></label>
      <div className="form-wide"><button type="submit">Save Item</button></div>
    </form>}

    {mode === "movement" && <form className="panel form-grid" onSubmit={saveMovement}>
      <h3 className="form-title">New Stock Movement / Goods Receipt</h3>
      <label>Date<input name="movementDate" type="date" required defaultValue={localDate()} /></label>
      <label>Movement<select name="movementType" value={movementType} onChange={(event) => { setMovementType(event.target.value); setSourcePoId(""); setMovementItemId(""); }}><option>PURCHASE_RECEIPT</option><option>PROJECT_ISSUE</option><option>ADJUSTMENT_IN</option><option>ADJUSTMENT_OUT</option><option>RETURN_IN</option><option>RETURN_OUT</option></select></label>

      {movementType === "PURCHASE_RECEIPT" ? <>
        <label>Source Purchase Order<select name="sourceDocumentId" value={sourcePoId} onChange={(event) => { setSourcePoId(event.target.value); setMovementItemId(""); }} required><option value="">Select approved Purchase Order</option>{approvedPurchaseOrders.map((po) => <option key={po.poId} value={po.poId}>{po.poNumber || po.poId} — {po.supplierId || "Supplier"}</option>)}</select></label>
        <label>Project<input name="projectId" value={selectedPo?.projectId || ""} readOnly placeholder="From Purchase Order" /></label>
      </> : <>
        <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></label>
        <label>Source Document ID<input name="sourceDocumentId" placeholder="Optional source reference" /></label>
      </>}

      <label>Item<select name="itemId" value={movementItemId} onChange={(event) => setMovementItemId(event.target.value)} required><option value="">Select stock item</option>{receiptEligibleItems.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}</select></label>
      <label>Quantity<input name="qty" type="number" min="0.0001" step="0.0001" required /></label>

      {autoMovementRate !== null ? <label>{movementType === "PURCHASE_RECEIPT" ? "PO Purchase Rate" : "Moving Average Issue Rate"}<input name="unitCost" type="number" value={Number(autoMovementRate || 0).toFixed(4)} readOnly /><span className="small">Automatically derived; manual editing is disabled.</span></label> : <label>Unit Cost<input name="unitCost" type="number" min="0" step="0.0001" defaultValue="0" required={isIncomingManualCost} /></label>}

      {movementType === "PURCHASE_RECEIPT" && selectedPo && <div className="form-wide panel" style={{ margin: 0 }}><strong>Linked Purchase Order:</strong> <Link prefetch={false} target="_blank" href={`/transactions/purchaseOrder/${encodeURIComponent(selectedPo.poId)}`}>{selectedPo.poNumber || selectedPo.poId}</Link><span className="small" style={{ display: "block", marginTop: 6 }}>Purchase receipt unit cost is taken from the matching PO line. The item moving-average rate is recalculated after saving.</span></div>}

      <div className="form-wide"><button type="submit">Save Movement</button></div>
    </form>}

    {mode === "details" && <>
      {!selectedItem && <section className="panel"><div className="form-title-row"><div><h3>Item & Stock Details</h3><p className="small">Click an item tile to open its full stock and purchase traceability view.</p></div><span className="auto-badge">{stock.length} Items</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginTop: 18 }}>{stock.map((item) => <button key={item.itemId} type="button" className="secondary" onClick={() => openItem(item.itemId)} style={{ minHeight: 120, textAlign: "left", padding: 16 }}><strong style={{ display: "block", fontSize: 16 }}>{item.itemCode} — {item.itemName}</strong><span style={{ display: "block", marginTop: 8 }}>Qty: {qtyText(item.qty)}</span><span style={{ display: "block", marginTop: 4 }}>Moving Avg: {money(item.defaultRate)}</span><span style={{ display: "block", marginTop: 4 }}>Book Value: {money(item.value)}</span></button>)}</div></section>}

      {selectedItem && <>
        <section className="panel"><div className="button-row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={() => setSelectedItemId("")}>← Back to Item List</button><span className="auto-badge">{selectedItem.itemType}</span></div><h3 style={{ marginTop: 18 }}>{selectedItem.itemCode} — {selectedItem.itemName}</h3><div className="document-meta" style={{ marginTop: 16 }}><div><span>Item Code</span><strong>{selectedItem.itemCode}</strong></div><div><span>Balance Qty</span><strong>{qtyText(selectedItem.qty)}</strong></div><div><span>Moving Average Rate</span><strong>{money(selectedItem.defaultRate)}</strong></div><div><span>Book Value</span><strong>{money(selectedItem.value)}</strong></div><div><span>Total Qty In</span><strong>{qtyText(selectedItem.qtyIn)}</strong></div><div><span>Total Qty Out</span><strong>{qtyText(selectedItem.qtyOut)}</strong></div><div><span>Revenue Account</span><strong>{selectedItem.revenueAccount || "—"}</strong></div><div><span>Cost Account</span><strong>{selectedItem.costAccount || "—"}</strong></div><div><span>Tax Code</span><strong>{selectedItem.taxCode || "—"}</strong></div><div><span>Movements</span><strong>{selectedItem.movementCount}</strong></div></div></section>

        <section className="panel table-wrap"><h3>Purchase Receipt & Valuation Tracking</h3><table className="data-table"><thead><tr><th>Receipt / Movement</th><th>Date</th><th>Purchase Order</th><th>Qty In</th><th>PO / Movement Rate</th><th>Moving Avg After</th><th>Value</th></tr></thead><tbody>{movements.filter((movement) => movement.itemId === selectedItem.itemId && movement.movementType === "PURCHASE_RECEIPT").length === 0 && <tr><td colSpan={7}>No PO-linked purchase receipts for this item.</td></tr>}{[...movements].filter((movement) => movement.itemId === selectedItem.itemId && movement.movementType === "PURCHASE_RECEIPT").reverse().map((movement) => <tr key={movement.movementId}><td><button type="button" className="secondary" onClick={() => openMovement(movement.movementId)}>{movement.movementId}</button></td><td>{movement.movementDate}</td><td>{sourceLink(movement)}</td><td>{qtyText(movement.qtyIn)}</td><td>{money(movement.unitCost)}</td><td><strong>{money(movementRates.get(movement.movementId) || 0)}</strong></td><td>{money(movement.value)}</td></tr>)}</tbody></table></section>

        <section className="panel table-wrap"><h3>Complete Item Movement History</h3><table className="data-table"><thead><tr><th>Movement</th><th>Date</th><th>Type</th><th>Qty In</th><th>Qty Out</th><th>Rate</th><th>Value</th><th>Source</th></tr></thead><tbody>{[...movements].filter((movement) => movement.itemId === selectedItem.itemId).reverse().map((movement) => <tr key={movement.movementId}><td><button type="button" className="secondary" onClick={() => openMovement(movement.movementId)}>{movement.movementId}</button></td><td>{movement.movementDate}</td><td>{movement.movementType}</td><td>{qtyText(movement.qtyIn)}</td><td>{qtyText(movement.qtyOut)}</td><td>{money(movement.unitCost)}</td><td>{money(movement.value)}</td><td>{sourceLink(movement)}</td></tr>)}</tbody></table></section>
      </>}
    </>}

    {mode === "register" && <>
      {selectedMovement && <section className="panel"><div className="button-row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={() => setSelectedMovementId("")}>← Back to Movement Register</button><span className="auto-badge">{selectedMovement.movementType}</span></div><h3 style={{ marginTop: 18 }}>Receipt / Movement {selectedMovement.movementId}</h3><div className="document-meta" style={{ marginTop: 16 }}><div><span>Date</span><strong>{selectedMovement.movementDate}</strong></div><div><span>Item</span><strong><button type="button" className="secondary" onClick={() => openItem(selectedMovement.itemId)}>{itemMap.get(selectedMovement.itemId)?.itemCode || selectedMovement.itemId}</button></strong></div><div><span>Project</span><strong>{selectedMovement.projectId || "—"}</strong></div><div><span>Qty In</span><strong>{qtyText(selectedMovement.qtyIn)}</strong></div><div><span>Qty Out</span><strong>{qtyText(selectedMovement.qtyOut)}</strong></div><div><span>Movement Rate</span><strong>{money(selectedMovement.unitCost)}</strong></div><div><span>Moving Avg After</span><strong>{money(movementRates.get(selectedMovement.movementId) || 0)}</strong></div><div><span>Value</span><strong>{money(selectedMovement.value)}</strong></div><div><span>Source Purchase Order</span><strong>{sourceLink(selectedMovement)}</strong></div></div></section>}

      {!selectedMovement && <section className="panel table-wrap"><div className="form-title-row"><div><h3>Movement Register</h3><p className="small">Movement ID, Item and linked Purchase Order are clickable for traceability.</p></div><span className="auto-badge">{movements.length} Movements</span></div><table className="data-table"><thead><tr><th>Date</th><th>Receipt / Movement</th><th>Type</th><th>Item</th><th>Project</th><th>Qty In</th><th>Qty Out</th><th>Rate</th><th>Moving Avg After</th><th>Value</th><th>Source</th></tr></thead><tbody>{[...movements].reverse().map((movement) => <tr key={movement.movementId}><td>{movement.movementDate}</td><td><button type="button" className="secondary" onClick={() => openMovement(movement.movementId)}>{movement.movementId}</button></td><td>{movement.movementType}</td><td><button type="button" className="secondary" onClick={() => openItem(movement.itemId)}>{itemMap.get(movement.itemId)?.itemCode || movement.itemId}</button></td><td>{movement.projectId || "—"}</td><td>{qtyText(movement.qtyIn)}</td><td>{qtyText(movement.qtyOut)}</td><td>{money(movement.unitCost)}</td><td><strong>{money(movementRates.get(movement.movementId) || 0)}</strong></td><td>{money(movement.value)}</td><td>{sourceLink(movement)}</td></tr>)}</tbody></table></section>}
    </>}
  </>;
}
