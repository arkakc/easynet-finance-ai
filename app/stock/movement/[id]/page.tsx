import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";

const num = (value: unknown) => Number(value || 0);
const money = (value: number) => `K${value.toFixed(2)}`;
const quantity = (value: unknown) => num(value).toLocaleString("en", { maximumFractionDigits: 4 });

export default async function StockMovementTracePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("stock.read");
  const { id } = await params;
  const { rows } = await findRecords<any>("StockMovements", { movementId: id }, 1);
  const movement = rows[0];
  if (!movement) notFound();

  const movementType = String(movement.movementType || "");
  const internalLineId = String(movement.movementId || id);
  const receiptMatch = movementType === "PURCHASE_RECEIPT" ? /^(.*)-(\d{3})$/.exec(internalLineId) : null;
  const documentNumber = receiptMatch ? receiptMatch[1] : internalLineId;
  const lineNumber = receiptMatch ? receiptMatch[2] : null;
  const rawValue = num(movement.valueAdjustment) || Math.abs(num(movement.value));
  const signedValue = num(movement.valueAdjustment) || (num(movement.qtyOut) > 0 ? -rawValue : rawValue);
  const sourceId = String(movement.sourceDocumentId || "");
  const journalId = String(movement.journalId || "");
  const itemId = String(movement.itemId || "");

  return <main className="document-page unified-item-detail">
    <div className="document-toolbar no-print">
      <Link prefetch={false} href={itemId ? `/stock/item/${encodeURIComponent(itemId)}` : "/stock"}>← Back to Item Movements</Link>
    </div>
    <section className="document-sheet">
      <header className="document-header">
        <div><div className="eyebrow">STOCK LEDGER · MOVEMENT TRACE</div><h1>{documentNumber}</h1>
          <p className="small">{movementType.replaceAll("_", " ")}{lineNumber ? ` · Line ${lineNumber}` : ""}</p>
        </div>
        <span className="auto-badge">Recorded movement</span>
      </header>
      <div className="item-detail-summary">
        <div><span>Quantity in</span><strong>{quantity(movement.qtyIn)}</strong></div>
        <div><span>Quantity out</span><strong>{quantity(movement.qtyOut)}</strong></div>
        <div><span>Unit cost</span><strong>{money(num(movement.unitCost))}</strong></div>
        <div><span>Value change</span><strong>{money(signedValue)}</strong></div>
      </div>
      <h3 className="item-detail-heading">Movement details & audit references</h3>
      <div className="document-meta">
        <div><span>Date</span><strong>{String(movement.movementDate || "").slice(0,10)}</strong></div>
        <div><span>Warehouse</span><strong>{movement.warehouseCode || movement.warehouseId || "LEGACY / DEFAULT"}</strong></div>
        <div><span>Movement type</span><strong>{movementType.replaceAll("_", " ")}</strong></div>
        <div><span>Line reference</span><strong>{internalLineId}</strong></div>
        <div><span>Item</span><strong>{itemId ? <Link prefetch={false} href={`/stock/item/${encodeURIComponent(itemId)}`}>{itemId}</Link> : "—"}</strong></div>
        <div><span>Project</span><strong>{movement.projectId || "—"}</strong></div>
        <div><span>Source document</span><strong>{sourceId ? <Link prefetch={false} href={movementType === "PURCHASE_RECEIPT" ? `/transactions/purchaseOrder/${encodeURIComponent(sourceId)}` : `/document-explorer?documentId=${encodeURIComponent(sourceId)}`}>{sourceId}</Link> : "—"}</strong></div>
        <div><span>GL journal</span><strong>{journalId ? <Link prefetch={false} href={`/journals/${encodeURIComponent(journalId)}`}>{journalId}</Link> : "—"}</strong></div>
      </div>
    </section>
  </main>;
}
