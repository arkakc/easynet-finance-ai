"use client";

import Link from "next/link";

export type TransactionItemMaster = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  uom?: string;
  defaultRate?: number | string;
};

export type TransactionDraftLine = {
  lineId?: string;
  itemId: string;
  itemInput: string;
  itemName: string;
  itemType: string;
  description: string;
  qty: string;
  uom: string;
  rate: string;
};

type Props = {
  lines: TransactionDraftLine[];
  items: TransactionItemMaster[];
  supplierQuotation?: boolean;
  temporaryQuotation?: boolean;
  masterOnly?: boolean;
  disabled?: boolean;
  onChange: (lines: TransactionDraftLine[]) => void;
};

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

function itemCode(item: TransactionItemMaster) {
  return String(item.itemCode || item.itemId || "");
}

function itemDisplay(item: TransactionItemMaster) {
  const code = itemCode(item);
  const name = String(item.itemName || code);
  return code && name !== code ? `${code} — ${name}` : name;
}

function resolveItem(items: TransactionItemMaster[], value: string) {
  const query = value.trim().toLowerCase();
  if (!query) return null;
  return items.find((item) => itemDisplay(item).toLowerCase() === query)
    || items.find((item) => itemCode(item).toLowerCase() === query)
    || items.find((item) => String(item.itemName || "").toLowerCase() === query)
    || null;
}

export function emptyTransactionLine(): TransactionDraftLine {
  return {
    lineId: "",
    itemId: "",
    itemInput: "",
    itemName: "",
    itemType: "STOCK",
    description: "",
    qty: "1",
    uom: "Each",
    rate: "0",
  };
}

export default function TransactionItemLines({
  lines,
  items,
  supplierQuotation = false,
  temporaryQuotation: temporaryQuotationProp,
  masterOnly = false,
  disabled = false,
  onChange,
}: Props) {
  const salesQuotationFromUrl = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "salesQuote";
  const temporaryQuotation = !masterOnly && (temporaryQuotationProp ?? (supplierQuotation || salesQuotationFromUrl));
  const datalistId = temporaryQuotation ? "quotation-item-master" : masterOnly ? "draft-document-item-master" : "transaction-item-master";

  function patchLine(index: number, patch: Partial<TransactionDraftLine>) {
    if (disabled) return;
    onChange(lines.map((line, rowIndex) => rowIndex === index ? { ...line, ...patch } : line));
  }

  function changeItem(index: number, value: string) {
    if (disabled) return;
    const match = resolveItem(items, value);
    if (match) {
      patchLine(index, {
        itemId: String(match.itemId || match.itemCode),
        itemInput: itemDisplay(match),
        itemName: String(match.itemName || itemCode(match)),
        itemType: String(match.itemType || "STOCK"),
        description: String(match.itemName || itemCode(match)),
        uom: String(match.uom || "Each"),
      });
      return;
    }

    patchLine(index, {
      itemId: "",
      itemInput: value,
      itemName: masterOnly ? "" : value,
      description: masterOnly ? "" : value,
    });
  }

  function addLine() {
    if (disabled) return;
    onChange([...lines, emptyTransactionLine()]);
  }

  function removeLine(index: number) {
    if (disabled) return;
    if (lines.length === 1) {
      onChange([emptyTransactionLine()]);
      return;
    }
    onChange(lines.filter((_, rowIndex) => rowIndex !== index));
  }

  return <>
    <datalist id={datalistId}>
      {items.map((item) => <option key={item.itemId || item.itemCode} value={itemDisplay(item)} />)}
    </datalist>

    <div className="table-wrap">
      <table className="data-table" style={{ minWidth: 1280 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 250 }}>Search / Enter Item</th>
            <th>Item Code</th>
            <th style={{ minWidth: 200 }}>Item Name</th>
            <th>UOM</th>
            <th>Moving Avg Cost</th>
            <th>QTY</th>
            <th>Unit Price</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const linked = line.itemId ? items.find((item) => String(item.itemId || item.itemCode) === line.itemId) : null;
            const movingAverage = linked ? Number(linked.defaultRate || 0) : 0;
            const temporary = temporaryQuotation && !linked;
            const pendingCreate = !masterOnly && !temporaryQuotation && !linked && line.itemName.trim();

            return <tr key={line.lineId || index}>
              <td>
                <input
                  list={datalistId}
                  value={line.itemInput}
                  onChange={(event) => changeItem(index, event.target.value)}
                  placeholder={masterOnly ? "Search and select Item Master" : temporaryQuotation ? "Search Item Master or type quotation item" : "Search Item Master or type new item"}
                  autoComplete="off"
                  required
                  disabled={disabled}
                />
                <span className="small" style={{ display: "block", marginTop: 6 }}>
                  {linked ? "Linked to Item Master" : masterOnly ? "Select an Item Master record before Save" : temporary ? "Temporary Quotation line — not saved to Item Master" : pendingCreate ? "New Item Master record will be created on Save" : "Search by Item Code or Item Name"}
                </span>
              </td>
              <td>
                {linked
                  ? <Link prefetch={false} href={`/stock/item/${encodeURIComponent(linked.itemId || linked.itemCode)}`}><strong>{itemCode(linked)}</strong></Link>
                  : <strong>{masterOnly ? "SELECT" : temporary ? "TEMP" : "AUTO"}</strong>}
              </td>
              <td>
                <input
                  value={line.itemName}
                  onChange={(event) => patchLine(index, { itemName: event.target.value, description: event.target.value, itemInput: linked ? line.itemInput : event.target.value })}
                  readOnly={Boolean(linked) || masterOnly}
                  required
                  disabled={disabled}
                />
                {!linked && !temporaryQuotation && !masterOnly && <select value={line.itemType} onChange={(event) => patchLine(index, { itemType: event.target.value })} style={{ marginTop: 6 }} disabled={disabled}>
                  <option value="STOCK">Stock Item</option>
                  <option value="SERVICE">Service Item</option>
                  <option value="NON_STOCK">Non-Stock Item</option>
                </select>}
              </td>
              <td><input value={line.uom} onChange={(event) => patchLine(index, { uom: event.target.value })} readOnly={masterOnly} required disabled={disabled} /></td>
              <td><input value={money(movingAverage)} readOnly disabled /></td>
              <td><input type="number" min="0.0001" step="0.0001" value={line.qty} onChange={(event) => patchLine(index, { qty: event.target.value })} required disabled={disabled} /></td>
              <td><input type="number" min="0" step="0.01" value={line.rate} onChange={(event) => patchLine(index, { rate: event.target.value })} required disabled={disabled} /></td>
              <td><strong>{money((Number(line.qty) || 0) * (Number(line.rate) || 0))}</strong></td>
              <td><button type="button" className="secondary" onClick={() => removeLine(index)} disabled={disabled}>Remove</button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    <div className="button-row" style={{ marginTop: 12 }}>
      <button type="button" className="secondary" onClick={addLine} disabled={disabled}>Add Line</button>
      {temporaryQuotation && <span className="small">Quotation allows temporary free-text items. Temporary rows are not saved to Item Master until the quotation is converted to the next operational document.</span>}
      {masterOnly && <span className="small">Operational draft lines must remain linked to Item Master.</span>}
    </div>
  </>;
}
