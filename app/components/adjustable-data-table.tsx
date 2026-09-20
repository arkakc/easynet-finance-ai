"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";

export type AdjustableColumn<T extends Record<string, unknown>> = {
  key: string;
  label: string;
  value: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => string | number;
  mandatory?: boolean;
  defaultWidth?: number;
};

type SortDirection = "asc" | "desc";

type Props<T extends Record<string, unknown>> = {
  rows: T[];
  columns: AdjustableColumn<T>[];
  loading?: boolean;
  emptyMessage: string;
  loadingMessage: string;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  rowAriaLabel?: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
};

function normalizeSortValue(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  if (text && Number.isFinite(numeric) && /^[K$€£0-9.,\s-]+$/.test(text)) return numeric;
  const date = Date.parse(text);
  if (text && Number.isFinite(date) && /\d{4}|\d{1,2}\/\d{1,2}/.test(text)) return date;
  return text.toLowerCase();
}

function nodeText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join(" ");
  if (typeof value === "object" && "props" in value) {
    const props = value.props as { children?: ReactNode };
    return nodeText(props.children);
  }
  return "";
}

export default function AdjustableDataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  loading = false,
  emptyMessage,
  loadingMessage,
  rowKey,
  onRowClick,
  rowAriaLabel,
  rowClassName,
}: Props<T>) {
  const [columnOrder, setColumnOrder] = useState(() => columns.map((column) => column.key));
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((column) => [column.key, column.defaultWidth || 170])),
  );
  const [sortKey, setSortKey] = useState(columns[0]?.key || "");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [dragKey, setDragKey] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(25);

  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const orderedColumns = columnOrder.map((key) => columnByKey.get(key)).filter(Boolean) as AdjustableColumn<T>[];

  const filteredRows = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row, rowIndex) =>
      columns.some((column) => {
        const value = column.sortValue ? column.sortValue(row) : nodeText(column.value(row, rowIndex));
        return String(value ?? "").toLowerCase().includes(query);
      }),
    );
  }, [columns, globalSearch, rows]);

  const sortedRows = useMemo(() => {
    const sortColumn = columnByKey.get(sortKey);
    if (!sortColumn) return filteredRows;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = normalizeSortValue(sortColumn.sortValue ? sortColumn.sortValue(a) : sortColumn.value(a, 0));
      const bv = normalizeSortValue(sortColumn.sortValue ? sortColumn.sortValue(b) : sortColumn.value(b, 0));
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [columnByKey, filteredRows, sortDirection, sortKey]);

  const visibleRows = sortedRows.slice(0, visibleLimit);
  const remainingRows = Math.max(0, sortedRows.length - visibleRows.length);

  useEffect(() => {
    setVisibleLimit(25);
  }, [globalSearch, rows]);

  function setSort(columnKey: string) {
    if (sortKey === columnKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(columnKey);
    setSortDirection("asc");
  }

  function moveColumn(sourceKey: string, targetKey: string) {
    if (!sourceKey || sourceKey === targetKey) return;
    setColumnOrder((current) => {
      const next = current.filter((key) => key !== sourceKey);
      const targetIndex = next.indexOf(targetKey);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, sourceKey);
      return next;
    });
  }

  function startResize(columnKey: string, startX: number) {
    const startWidth = widths[columnKey] || 170;
    const onMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      setWidths((current) => ({ ...current, [columnKey]: Math.max(90, startWidth + delta) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const colSpan = Math.max(orderedColumns.length + 1, 1);
  const minWidth = 90 + orderedColumns.reduce((sum, column) => sum + (widths[column.key] || column.defaultWidth || 170), 0);

  return (
    <div className="adjustable-table">
      <div className="adjustable-table-toolbar">
        <label>
          Global search
          <input
            type="search"
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
            placeholder="Search list..."
          />
        </label>
        <label>
          Sort by
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            {orderedColumns.map((column) => (
              <option key={column.key} value={column.key}>{column.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}>
          {sortDirection === "asc" ? "Ascending ↑" : "Descending ↓"}
        </button>
        <button type="button" className="secondary" onClick={() => setVisibleLimit((current) => current + 25)} disabled={remainingRows === 0}>
          {remainingRows > 0 ? `Load more (${remainingRows} more)` : "All loaded"}
        </button>
        <span className="small">Drag column headers to move. Pull the right edge to resize.</span>
      </div>

      <div className="table-wrap">
        <table className="data-table adjustable-data-table" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: 90 }} />
            {orderedColumns.map((column) => (
              <col key={column.key} style={{ width: widths[column.key] || column.defaultWidth || 170 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 90 }}>SL No</th>
              {orderedColumns.map((column) => (
                <th
                  key={column.key}
                  draggable
                  onDragStart={() => setDragKey(column.key)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveColumn(dragKey, column.key)}
                  className={sortKey === column.key ? "sorted-column" : undefined}
                >
                  <div className="adjustable-th-content">
                    <button type="button" className="table-sort-button" onClick={() => setSort(column.key)}>
                      {column.label} {sortKey === column.key ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                    </button>
                    <span
                      className="column-resizer"
                      role="separator"
                      aria-label={`Resize ${column.label}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        startResize(column.key, event.clientX);
                      }}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && visibleRows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={[rowClassName?.(row, index), onRowClick ? "clickable-data-row" : ""].filter(Boolean).join(" ") || undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                aria-label={onRowClick ? rowAriaLabel?.(row, index) || "Open record" : undefined}
                onClick={() => onRowClick?.(row, index)}
                onKeyDown={(event) => {
                  if (!onRowClick) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(row, index);
                  }
                }}
              >
                <td><strong>{index + 1}</strong></td>
                {orderedColumns.map((column) => (
                  <td key={column.key}>{column.value(row, index)}</td>
                ))}
              </tr>
            ))}
            {!loading && sortedRows.length === 0 && (
              <tr><td colSpan={colSpan}>{emptyMessage}</td></tr>
            )}
            {loading && (
              <tr><td colSpan={colSpan}>{loadingMessage}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
