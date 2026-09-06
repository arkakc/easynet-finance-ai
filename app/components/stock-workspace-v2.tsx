"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "menu" | "newItem" | "movement" | "details" | "register";

type Item = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  uom?: string;
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
  uom?: string;
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

function approvedLifecycle(status: unknown) {
  return ["APPROVED", "PART_RECEIVED", "CONVERTED", "BILL_CREATED", "BILLED"].includes(String(status || "").toUpperCase());
}

export default function StockWorkspaceV2() {
  const [mode, setMode] = useState<Mode>("menu");
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [poLines, setPoLines] = useState<POLine[]>([]);
  const [nextItemCode, setNextItemCode] = useState("Loading…");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [initialContextApplied, setInitialContextApplied] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedMovementId, setSelectedMovementId] = useState("");
  const [movementType, setMovementType] = useState("PURCHASE_RECEIPT");
  const [sourcePoId, setSourcePoId] = useState("");
  const [movementItemId, setMovementItemId] = useState("");
  const [movementQty, setMovementQty] = useState("");

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

  const itemMap = useMemo(() => new Map(items.map((item) => [String(item.itemId), item])), [items]);
  const poMap = useMemo(() => new Map(purchaseOrders.map((po) => [String(po.poId), po])), [purchaseOrders]);

  const stock = useMemo(() => items.map((item) => {
    const rows = movements.filter((movement) => String(movement.itemId) === String(item.itemId));
    const qtyIn = rows.reduce((sum, movement) => sum + n(movement.qtyIn), 0);
    const qtyOut = rows.reduce((sum, movement) => sum + n(movement.qtyOut), 0);
    const qty = n(item.stockQty ?? qtyIn - qtyOut);
    const value = n(item.stockValue ?? rows.reduce((sum, movement) => sum + (n(movement.qtyIn) > 0 ? n(movement.value) : -n(movement.value)), 0));
    return { ...item, qtyIn, qtyOut, qty, value, movementCount: rows.length };
  }), [items, movements]);

  const stockItems = useMemo(() => items.filter((item) => String(item.itemType || "").toUpperCase() === "STOCK"), [items]);

  function receivedFor(poId: string, itemId: string) {
    return movements
      .filter((movement) => movement.movementType === "PURCHASE_RECEIPT" && String(movement.sourceDocumentId || "") === poId && String(movement.itemId || "") === itemId)
      .reduce((sum, movement) => sum + n(movement.qtyIn), 0);
  }

  function orderedFor(poId: string, itemId: string) {
    return poLines
      .filter((line) => String(line.poId || "") === poId && String(line.itemId || "") === itemId)
      .reduce((sum, line) => sum + n(line.qty), 0);
  }

  function remainingFor(poId: string, itemId: string) {
    return Math.max(0, orderedFor(poId, itemId) - receivedFor(poId, itemId));
  }

  function poHasRemainingStock(poId: string) {
    return poLines.some((line) => {
      const item = itemMap.get(String(line.itemId || ""));
      return item && String(item.itemType || "").toUpperCase() === "STOCK" && remainingFor(poId, String(item.itemId)) > 0.0001;
    });
  }

  const receiptReadyPurchaseOrders = useMemo(() => purchaseOrders.filter((po) => {
    const number = String(po.poNumber || "").toUpperCase();
    return !number.startsWith("SUPQ-") && approvedLifecycle(po.status) && poHasRemainingStock(String(po.poId));
  }), [purchaseOrders, poLines, movements, itemMap]);

  const selectedPo = useMemo(() => purchaseOrders.find((po) => String(po.poId) === sourcePoId) || null, [purchaseOrders, sourcePoId]);
  const selectedPoLines = useMemo(() => poLines.filter((line) => String(line.poId || "") === sourcePoId), [poLines, sourcePoId]);

  const receiptEligibleItems = useMemo(() => {
    if (movementType !== "PURCHASE_RECEIPT" || !sourcePoId) return stockItems;
    return stockItems.filter((item) => selectedPoLines.some((line) => String(line.itemId || "") === String(item.itemId)) && remainingFor(sourcePoId, String(item.itemId)) > 0.0001);
  }, [movementType, sourcePoId, selectedPoLines, stockItems, movements]);

  const selectedMovementItem = useMemo(() => items.find((item) => String(item.itemId) === movementItemId) || null, [items, movementItemId]);
  const matchingPoLines = useMemo(() => selectedPoLines.filter((line) => String(line.itemId || "") === movementItemId), [selectedPoLines, movementItemId]);
  const orderedQty = matchingPoLines.reduce((sum, line) => sum + n(line.qty), 0);
  const alreadyReceivedQty = sourcePoId && movementItemId ? receivedFor(sourcePoId, movementItemId) : 0;
  const remainingQty = Math.max(0, orderedQty - alreadyReceivedQty);
  const poPurchaseRate = (() => {
    const qty = matchingPoLines.reduce((sum, line) => sum + n(line.qty), 0);
    if (!(qty > 0)) return 0;
    return matchingPoLines.reduce((sum, line) => sum + n(line.qty) * n(line.rate), 0) / qty;
  })();

  const currentMovingAverage = n(selectedMovementItem?.defaultRate);
  const currentStockQty = n(selectedMovementItem?.stockQty);
  const receiptQtyNumber = n(movementQty);
  const projectedMovingAverage = movementType === "PURCHASE_RECEIPT" && selectedMovementItem && receiptQtyNumber > 0
    ? ((currentStockQty * currentMovingAverage) + (receiptQtyNumber * poPurchaseRate)) / Math.max(0.0000001, currentStockQty + receiptQtyNumber)
    : currentMovingAverage;

  const isIncomingManualCost = movementType === "ADJUSTMENT_IN" || movementType === "RETURN_IN";
  const autoMovementRate = movementType === "PURCHASE_RECEIPT"
    ? poPurchaseRate
    : !["PURCHASE_RECEIPT", "ADJUSTMENT_IN", "RETURN_IN"].includes(movementType)
      ? currentMovingAverage
      : null;

  const selectedItem = useMemo(() => stock.find((item) => String(item.itemId) === selectedItemId) || null, [stock, selectedItemId]);
  const selectedMovement = useMemo(() => movements.find((movement) => String(movement.movementId) === selectedMovementId) || null, [movements, selectedMovementId]);

  const movementRates = useMemo(() => {
    const map = new Map<string, number>();
    const states = new Map<string, { qty: number; value: number; rate: number }>();
    for (const movement of movements) {
      const current = states.get(String(movement.itemId)) || { qty: 0, value: 0, rate: 0 };
      const incoming = n(movement.qtyIn) > 0;
      const nextQty = current.qty + n(movement.qtyIn) - n(movement.qtyOut);
      const nextValue = current.value + (incoming ? n(movement.value) : -n(movement.value));
      const nextRate = nextQty > 0 ? nextValue / nextQty : current.rate || n(movement.unitCost);
      states.set(String(movement.itemId), { qty: nextQty, value: nextValue, rate: Math.max(0, nextRate) });
      map.set(String(movement.movementId), Math.max(0, nextRate));
    }
    return map;
  }, [movements]);

  useEffect(() => {
    if (loading || initialContextApplied || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode");
    const requestedPo = String(params.get("sourcePo") || "");
    if (requestedMode === "movement" || requestedPo) {
      setMode("movement");
      setMovementType("PURCHASE_RECEIPT");
    }
    if (requestedPo) {
      const po = purchaseOrders.find((row) => String(row.poId) === requestedPo);
      if (!po) setMessage("Purchase Order not found.");
      else if (!approvedLifecycle(po.status)) setMessage("Purchase Receipt can only be created from an approved Purchase Order.");
      else if (!poHasRemainingStock(requestedPo)) setMessage("This Purchase Order has no remaining stock quantity to receive.");
      else setSourcePoId(requestedPo);
    }
    setInitialContextApplied(true);
  }, [loading, initialContextApplied, purchaseOrders, poLines, movements]);

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
    } else if (String(body.row.movementType) === "PURCHASE_RECEIPT") {
      setMessage(`Purchase Receipt saved: ${body.row.movementId} · Moving Average ${money(body.valuation?.movingAverageRate)}`);
    } else {
      setMessage(`Movement saved: ${body.row.movementId} · Moving Average ${money(body.valuation?.movingAverageRate)}`);
    }
    await load();
    return body;
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
      setMovementItemId("");
      setMovementQty("");
      if (movementType !== "PURCHASE_RECEIPT") {
        setSourcePoId("");
        setMovementType("PURCHASE_RECEIPT");
      }
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
    const po = poMap.get(String(movement.sourceDocumentId));
    if (po) {
      return <Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(po.poId)}`}><strong>{po.poNumber || po.poId}</strong></Link>;
    }
    return <span>{movement.sourceDocumentId}</span>;
  };

  return <>
    <div className="page-heading">
      <div><h2>Items & Stock</h2><p className="small">Item Master, PO-linked Purchase Receipts, stock valuation and movement traceability.</p></div>
    </div>

    {message && <section className="panel status-banner"><strong>Status:</strong> {message}</section>}

    {mode === "menu" && <section className="panel">
      <h3>Items & Stock</h3>
      <p className="small">Choose one workspace. Purchase Receipts always require an approved Purchase Order.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16, marginTop: 20 }}>
        <button type="button" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("newItem")}><strong style={{ display: "block", fontSize: 17 }}>New Item</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Create a Stock, Service or Non-Stock Item Master record.</span></button>
        <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("movement")}><strong style={{ display: "block", fontSize: 17 }}>New Stock Movement / Goods Receipt</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Create a PO-linked Purchase Receipt or another controlled stock movement.</span></button>
        <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("details")}><strong style={{ display: "block", fontSize: 17 }}>Item & Stock Details</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Review item balance, UOM, moving-average cost, value and linked purchase history.</span></button>
        <button type="button" className="secondary" style={{ minHeight: 110, textAlign: "left" }} onClick={() => openMode("register")}><strong style={{ display: "block", fontSize: 17 }}>Movement Register</strong><span style={{ display: "block", marginTop: 8, fontWeight: 400 }}>Trace every receipt, issue, return and adjustment to its source.</span></button>
      </div>
    </section>}

    {mode !== "menu" && <section className="panel"><div className="button-row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={() => { setMode("menu"); setSelectedItemId(""); setSelectedMovementId(""); }}>← Back to Items & Stock</button><span className="auto-badge">{loading ? "Loading…" : `${items.length} Items · ${movements.length} Movements`}</span></div></section>}

    {mode === "newItem" && <form className="panel form-grid" onSubmit={saveItem}>
      <h3 className="form-title">New Item</h3>
      <label>Item Code<input value={nextItemCode || "AUTO"} readOnly /></label>
      <label>Item Name<input name="itemName" required /></label>
      <label>Type<select name="itemType" defaultValue="STOCK"><option>STOCK</option><option>SERVICE</option><option>NON_STOCK</option></select></label>
      <label>Default UOM<input name="uom" defaultValue="Each" required /></label>
      <label>Revenue Account<input name="revenueAccount" defaultValue="ACC-4200" /></label>
      <label>Cost Account<input name="costAccount" defaultValue="ACC-5100" /></label>
      <label>Moving Average Rate<input value="0.00" readOnly /><span className="small">Read-only. Stock valuation changes from PO-linked Purchase Receipts.</span></label>
      <label>Tax Code<input name="taxCode" /></label>
      <div className="form-wide"><button type="submit">Save Item</button></div>
    </form>}

    {mode === "movement" && <form className="panel form-grid" onSubmit={saveMovement}>
      <div className="form-wide form-title-row"><div><h3>New Stock Movement / Goods Receipt</h3><p className="small">Purchase Receipt uses the same validation and moving-average engine whether opened from a Purchase Order or from this workspace.</p></div></div>
      <label>Date<input name="movementDate" type="date" required defaultValue={localDate()} /></label>
      <label>Movement<select name="movementType" value={movementType} onChange={(event) => { setMovementType(event.target.value); setSourcePoId(""); setMovementItemId(""); setMovementQty(""); }}><option value="PURCHASE_RECEIPT">PURCHASE RECEIPT / GOODS RECEIPT</option><option>PROJECT_ISSUE</option><option>ADJUSTMENT_IN</option><option>ADJUSTMENT_OUT</option><option>RETURN_IN</option><option>RETURN_OUT</option></select></label>

      {movementType === "PURCHASE_RECEIPT" ? <>
        <label>Approved Purchase Order<select name="sourceDocumentId" value={sourcePoId} onChange={(event) => { setSourcePoId(event.target.value); setMovementItemId(""); setMovementQty(""); }} required><option value="">Select approved PO with quantity remaining</option>{receiptReadyPurchaseOrders.map((po) => <option key={po.poId} value={po.poId}>{po.poNumber || po.poId} — {po.supplierId || "Supplier"}</option>)}</select></label>
        <label>Project<input name="projectId" value={selectedPo?.projectId || ""} readOnly placeholder="From Purchase Order" /></label>
      </> : <>
        <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></label>
        <label>Source Document ID<input name="sourceDocumentId" placeholder="Optional source reference" /></label>
      </>}

      {movementType === "PURCHASE_RECEIPT" && selectedPo && <section className="form-wide panel table-wrap" style={{ margin: 0 }}>
        <div className="form-title-row"><div><h4 style={{ margin: 0 }}>Purchase Order Items Ready to Receive</h4><p className="small">Only Item Master-linked STOCK items with remaining quantity are receivable.</p></div><Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(selectedPo.poId)}`}>{selectedPo.poNumber || selectedPo.poId}</Link></div>
        <table className="data-table"><thead><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>PO Rate</th><th>Moving Avg</th></tr></thead><tbody>{receiptEligibleItems.length === 0 && <tr><td colSpan={8}>No stock quantity remains to be received for this Purchase Order.</td></tr>}{receiptEligibleItems.map((item) => {
          const lines = selectedPoLines.filter((line) => String(line.itemId || "") === String(item.itemId));
          const ordered = lines.reduce((sum, line) => sum + n(line.qty), 0);
          const received = receivedFor(sourcePoId, String(item.itemId));
          const rate = ordered > 0 ? lines.reduce((sum, line) => sum + n(line.qty) * n(line.rate), 0) / ordered : 0;
          return <tr key={item.itemId}><td><Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId)}`}><strong>{item.itemCode || item.itemId}</strong></Link></td><td>{item.itemName}</td><td>{item.uom || lines[0]?.uom || "Each"}</td><td>{qtyText(ordered)}</td><td>{qtyText(received)}</td><td><strong>{qtyText(Math.max(0, ordered - received))}</strong></td><td>{money(rate)}</td><td>{money(item.defaultRate)}</td></tr>;
        })}</tbody></table>
      </section>}

      <label>Item<select name="itemId" value={movementItemId} onChange={(event) => { setMovementItemId(event.target.value); setMovementQty(""); }} required><option value="">Select stock item</option>{receiptEligibleItems.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemCode} — {item.itemName}</option>)}</select></label>
      <label>Quantity<input name="qty" type="number" min="0.0001" max={movementType === "PURCHASE_RECEIPT" && remainingQty > 0 ? remainingQty : undefined} step="0.0001" value={movementQty} onChange={(event) => setMovementQty(event.target.value)} required /></label>

      {autoMovementRate !== null ? <label>{movementType === "PURCHASE_RECEIPT" ? "PO Purchase Rate" : "Moving Average Issue Rate"}<input name="unitCost" type="number" value={Number(autoMovementRate || 0).toFixed(4)} readOnly /></label> : <label>Unit Cost<input name="unitCost" type="number" min="0" step="0.0001" defaultValue="0" required={isIncomingManualCost} /></label>}

      {movementType === "PURCHASE_RECEIPT" && selectedMovementItem && <section className="form-wide panel" style={{ margin: 0 }}>
        <h4 style={{ marginTop: 0 }}>Purchase Receipt Valuation Preview</h4>
        <div className="document-meta">
          <div><span>Item</span><strong><Link prefetch={false} href={`/stock/item/${encodeURIComponent(selectedMovementItem.itemId)}`}>{selectedMovementItem.itemCode} — {selectedMovementItem.itemName}</Link></strong></div>
          <div><span>UOM</span><strong>{selectedMovementItem.uom || matchingPoLines[0]?.uom || "Each"}</strong></div>
          <div><span>Ordered Qty</span><strong>{qtyText(orderedQty)}</strong></div>
          <div><span>Already Received</span><strong>{qtyText(alreadyReceivedQty)}</strong></div>
          <div><span>Remaining Qty</span><strong>{qtyText(remainingQty)}</strong></div>
          <div><span>PO Purchase Rate</span><strong>{money(poPurchaseRate)}</strong></div>
          <div><span>Current Stock Qty</span><strong>{qtyText(currentStockQty)}</strong></div>
          <div><span>Current Moving Average</span><strong>{money(currentMovingAverage)}</strong></div>
          <div><span>Projected Moving Average</span><strong>{money(projectedMovingAverage)}</strong></div>
        </div>
      </section>}

      <div className="form-wide"><button type="submit">{movementType === "PURCHASE_RECEIPT" ? "Save Purchase Receipt" : "Save Movement"}</button></div>
    </form>}

    {mode === "details" && <>
      {!selectedItem && <section className="panel"><div className="form-title-row"><div><h3>Item & Stock Details</h3><p className="small">Click an item to open stock and purchase traceability.</p></div><span className="auto-badge">{stock.length} Items</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginTop: 18 }}>{stock.map((item) => <button key={item.itemId} type="button" className="secondary" onClick={() => openItem(String(item.itemId))} style={{ minHeight: 120, textAlign: "left", padding: 16 }}><strong style={{ display: "block", fontSize: 16 }}>{item.itemCode} — {item.itemName}</strong><span style={{ display: "block", marginTop: 8 }}>UOM: {item.uom || "Each"}</span><span style={{ display: "block", marginTop: 4 }}>Qty: {qtyText(item.qty)}</span><span style={{ display: "block", marginTop: 4 }}>Moving Avg: {money(item.defaultRate)}</span><span style={{ display: "block", marginTop: 4 }}>Book Value: {money(item.value)}</span></button>)}</div></section>}

      {selectedItem && <>
        <section className="panel"><div className="button-row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={() => setSelectedItemId("")}>← Back to Item List</button><Link prefetch={false} href={`/stock/item/${encodeURIComponent(selectedItem.itemId)}`}>Open Item Master</Link></div><h3 style={{ marginTop: 18 }}>{selectedItem.itemCode} — {selectedItem.itemName}</h3><div className="document-meta" style={{ marginTop: 16 }}><div><span>Item Code</span><strong>{selectedItem.itemCode}</strong></div><div><span>UOM</span><strong>{selectedItem.uom || "Each"}</strong></div><div><span>Balance Qty</span><strong>{qtyText(selectedItem.qty)}</strong></div><div><span>Moving Average Rate</span><strong>{money(selectedItem.defaultRate)}</strong></div><div><span>Book Value</span><strong>{money(selectedItem.value)}</strong></div><div><span>Total Qty In</span><strong>{qtyText(selectedItem.qtyIn)}</strong></div><div><span>Total Qty Out</span><strong>{qtyText(selectedItem.qtyOut)}</strong></div><div><span>Revenue Account</span><strong>{selectedItem.revenueAccount || "—"}</strong></div><div><span>Cost Account</span><strong>{selectedItem.costAccount || "—"}</strong></div><div><span>Movements</span><strong>{selectedItem.movementCount}</strong></div></div></section>

        <section className="panel table-wrap"><h3>Purchase Receipt & Valuation Tracking</h3><table className="data-table"><thead><tr><th>Purchase Receipt</th><th>Date</th><th>Purchase Order</th><th>Qty In</th><th>PO Rate</th><th>Moving Avg After</th><th>Value</th></tr></thead><tbody>{movements.filter((movement) => String(movement.itemId) === String(selectedItem.itemId) && movement.movementType === "PURCHASE_RECEIPT").length === 0 && <tr><td colSpan={7}>No PO-linked Purchase Receipts for this item.</td></tr>}{[...movements].filter((movement) => String(movement.itemId) === String(selectedItem.itemId) && movement.movementType === "PURCHASE_RECEIPT").reverse().map((movement) => <tr key={movement.movementId}><td><button type="button" className="secondary" onClick={() => openMovement(String(movement.movementId))}>{movement.movementId}</button></td><td>{movement.movementDate}</td><td>{sourceLink(movement)}</td><td>{qtyText(movement.qtyIn)}</td><td>{money(movement.unitCost)}</td><td><strong>{money(movementRates.get(String(movement.movementId)) || 0)}</strong></td><td>{money(movement.value)}</td></tr>)}</tbody></table></section>
      </>}
    </>}

    {mode === "register" && <>
      {selectedMovement && <section className="panel"><div className="button-row" style={{ justifyContent: "space-between" }}><button type="button" className="secondary" onClick={() => setSelectedMovementId("")}>← Back to Movement Register</button><span className="auto-badge">{selectedMovement.movementType}</span></div><h3 style={{ marginTop: 18 }}>{selectedMovement.movementType === "PURCHASE_RECEIPT" ? "Purchase Receipt" : "Stock Movement"} {selectedMovement.movementId}</h3><div className="document-meta" style={{ marginTop: 16 }}><div><span>Date</span><strong>{selectedMovement.movementDate}</strong></div><div><span>Item</span><strong><Link prefetch={false} href={`/stock/item/${encodeURIComponent(selectedMovement.itemId)}`}>{itemMap.get(String(selectedMovement.itemId))?.itemCode || selectedMovement.itemId}</Link></strong></div><div><span>Project</span><strong>{selectedMovement.projectId || "—"}</strong></div><div><span>Qty In</span><strong>{qtyText(selectedMovement.qtyIn)}</strong></div><div><span>Qty Out</span><strong>{qtyText(selectedMovement.qtyOut)}</strong></div><div><span>Movement Rate</span><strong>{money(selectedMovement.unitCost)}</strong></div><div><span>Moving Avg After</span><strong>{money(movementRates.get(String(selectedMovement.movementId)) || 0)}</strong></div><div><span>Value</span><strong>{money(selectedMovement.value)}</strong></div><div><span>Source Purchase Order</span><strong>{sourceLink(selectedMovement)}</strong></div></div></section>}

      {!selectedMovement && <section className="panel table-wrap"><div className="form-title-row"><div><h3>Movement Register</h3><p className="small">Purchase Receipt IDs, Item Master and linked Purchase Orders are clickable.</p></div><span className="auto-badge">{movements.length} Movements</span></div><table className="data-table"><thead><tr><th>Date</th><th>Receipt / Movement</th><th>Type</th><th>Item</th><th>Project</th><th>Qty In</th><th>Qty Out</th><th>Rate</th><th>Moving Avg After</th><th>Value</th><th>Source</th></tr></thead><tbody>{[...movements].reverse().map((movement) => <tr key={movement.movementId}><td>{movement.movementDate}</td><td><button type="button" className="secondary" onClick={() => openMovement(String(movement.movementId))}>{movement.movementId}</button></td><td>{movement.movementType}</td><td><Link prefetch={false} href={`/stock/item/${encodeURIComponent(movement.itemId)}`}>{itemMap.get(String(movement.itemId))?.itemCode || movement.itemId}</Link></td><td>{movement.projectId || "—"}</td><td>{qtyText(movement.qtyIn)}</td><td>{qtyText(movement.qtyOut)}</td><td>{money(movement.unitCost)}</td><td><strong>{money(movementRates.get(String(movement.movementId)) || 0)}</strong></td><td>{money(movement.value)}</td><td>{sourceLink(movement)}</td></tr>)}</tbody></table></section>}
    </>}
  </>;
}
