import Link from "next/link";
import { notFound } from "next/navigation";
import { findRecords } from "@/lib/backend/apps-script";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;
const qtyText = (value: unknown) => n(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
const signedMovementValue = (row: any) => {
  const adjustment = n(row.valueAdjustment);
  if (Math.abs(adjustment) > 0.0000001) return adjustment;
  const value = Math.abs(n(row.value));
  if (n(row.qtyIn) > 0) return value;
  if (n(row.qtyOut) > 0) return -value;
  return 0;
};

export default async function ItemMasterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("stock.read");
  const { id } = await params;

  const [itemResult, movementResult] = await Promise.all([
    findRecords<any>("Items", { itemId: id }, 1),
    findRecords<any>("StockMovements", { itemId: id }, 500),
  ]);

  const item = itemResult.rows[0];
  if (!item) notFound();

  const movements = movementResult.rows || [];
  const qtyIn = movements.reduce((sum: number, row: any) => sum + n(row.qtyIn), 0);
  const qtyOut = movements.reduce((sum: number, row: any) => sum + n(row.qtyOut), 0);
  const balanceQty = qtyIn - qtyOut;
  const bookValue = movements.reduce((sum: number, row: any) => sum + signedMovementValue(row), 0);
  const movingAverage = balanceQty > 0 ? bookValue / balanceQty : n(item.defaultRate);
  const warehouseBalances = await prisma.warehouseStockBalance.findMany({
    where: { itemId: String(item.itemId || id) },
    include: { warehouse: true },
    orderBy: [{ warehouse: { code: "asc" } }],
  });

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <Link prefetch={false} href="/stock">← Back to Items & Stock</Link>
    </div>

    <section className="document-sheet">
      <header className="document-header">
        <div>
          <div className="eyebrow">ITEM MASTER</div>
          <h1>{item.itemName || item.itemCode || item.itemId}</h1>
          <div className="document-number">{item.itemCode || item.itemId}</div>
        </div>
        <div className={`status-pill status-${String(item.active).toLowerCase() === "false" ? "cancelled" : "approved"}`}>{String(item.active).toLowerCase() === "false" ? "INACTIVE" : "ACTIVE"}</div>
      </header>

      <div className="document-meta">
        <div><span>Item Code</span><strong>{item.itemCode || item.itemId}</strong></div>
        <div><span>Item Name</span><strong>{item.itemName || "—"}</strong></div>
        <div><span>Type</span><strong>{item.itemType || "—"}</strong></div>
        <div><span>Default UOM</span><strong>{item.uom || "Each"}</strong></div>
        <div><span>Moving Average Cost</span><strong>{money(movingAverage)}</strong></div>
        <div><span>Stock Balance</span><strong>{qtyText(balanceQty)}</strong></div>
        <div><span>Book Value</span><strong>{money(bookValue)}</strong></div>
        <div><span>Revenue Account</span><strong>{item.revenueAccount || "—"}</strong></div>
        <div><span>Cost Account</span><strong>{item.costAccount || "—"}</strong></div>
        <div><span>Tax Code</span><strong>{item.taxCode || "—"}</strong></div>
      </div>

      <div className="document-lines">
        <h3>Warehouse Balances</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Warehouse</th><th>Qty</th><th>Reserved</th><th>Available</th><th>Moving Average</th><th>Book Value</th></tr></thead>
            <tbody>
              {warehouseBalances.length === 0 && <tr><td colSpan={6}>No warehouse balance rows yet. Legacy stock will be assigned by the controlled warehouse backfill.</td></tr>}
              {warehouseBalances.map((row) => <tr key={row.id}>
                <td><strong>{row.warehouse.code}</strong><br /><span className="small">{row.warehouse.name}</span></td>
                <td>{qtyText(row.quantity)}</td>
                <td>{qtyText(row.reserved)}</td>
                <td><strong>{qtyText(row.available)}</strong></td>
                <td>{money(row.valuationRate)}</td>
                <td><strong>{money(row.stockValue)}</strong></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="document-lines">
        <h3>Movement & Source Document Tracking</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Warehouse</th><th>Movement</th><th>Qty In</th><th>Qty Out</th><th>Unit Cost</th><th>Value</th><th>Project</th><th>Source Document</th></tr></thead>
            <tbody>
              {movements.length === 0 && <tr><td colSpan={9}>No stock movements recorded for this item.</td></tr>}
              {[...movements].reverse().map((row: any) => <tr key={row.movementId}>
                <td>{row.movementDate}</td>
                <td><strong>{row.warehouseCode || "LEGACY / DEFAULT"}</strong>{row.warehouseName ? <><br /><span className="small">{row.warehouseName}</span></> : null}</td>
                <td>{row.movementType}<br /><span className="small">{row.movementId}</span></td>
                <td>{qtyText(row.qtyIn)}</td>
                <td>{qtyText(row.qtyOut)}</td>
                <td>{money(row.unitCost)}</td>
                <td>{money(row.value)}</td>
                <td>{row.projectId || "—"}</td>
                <td>{row.sourceDocumentId ? <Link prefetch={false} href={`/transactions/purchaseOrder/${encodeURIComponent(row.sourceDocumentId)}`}><strong>{row.sourceDocumentId}</strong></Link> : "—"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>;
}
