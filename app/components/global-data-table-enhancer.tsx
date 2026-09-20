"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function cellValue(cell: HTMLTableCellElement | undefined) {
  const text = (cell?.innerText || "").trim();
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  if (text && Number.isFinite(numeric) && /^[K$€£0-9.,\s-]+$/.test(text)) return numeric;
  const date = Date.parse(text);
  if (text && Number.isFinite(date) && /\d{4}|\d{1,2}\/\d{1,2}/.test(text)) return date;
  return text.toLowerCase();
}

function sortTable(table: HTMLTableElement, columnIndex: number, direction: "asc" | "desc") {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const factor = direction === "asc" ? 1 : -1;
  const rows = Array.from(tbody.rows);
  rows.sort((a, b) => {
    const av = cellValue(a.cells[columnIndex]);
    const bv = cellValue(b.cells[columnIndex]);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * factor;
  });
  rows.forEach((row) => tbody.appendChild(row));
}

function moveColumn(table: HTMLTableElement, from: number, to: number) {
  if (from === to || from < 0 || to < 0) return;
  const rows = Array.from(table.rows);
  rows.forEach((row) => {
    const cells = Array.from(row.children);
    const source = cells[from];
    const target = cells[to];
    if (!source || !target) return;
    row.insertBefore(source, from < to ? target.nextSibling : target);
  });
}

function columnLabels(headerRow: HTMLTableRowElement) {
  return Array.from(headerRow.cells)
    .filter((cell) => (cell as HTMLTableCellElement).dataset.serialColumn !== "true")
    .map((cell, index) => ({
      index: Array.from(headerRow.cells).indexOf(cell),
      label: (cell.textContent || `Column ${index + 1}`).replace(/[↑↓]/g, "").trim(),
    }))
    .filter((column) => column.label);
}

function shouldShowDoctypeListToolbar(table: HTMLTableElement) {
  return table.dataset.doctypeListView === "true" || Boolean(table.closest("[data-doctype-list-view='true']"));
}

function setTextIfChanged(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

function doctypeListRows(table: HTMLTableElement) {
  return Array.from(table.tBodies[0]?.rows || []).filter((row) => {
    if (row.cells.length <= 1) return false;
    return !Array.from(row.cells).some((cell) => cell.colSpan > 1);
  });
}

function ensureSerialColumn(table: HTMLTableElement, headerRow: HTMLTableRowElement) {
  if (!shouldShowDoctypeListToolbar(table)) return;

  const firstHeader = headerRow.cells[0] as HTMLTableCellElement | undefined;
  if (firstHeader?.dataset.serialColumn !== "true") {
    const th = document.createElement("th");
    th.textContent = "SL No";
    th.dataset.serialColumn = "true";
    th.style.width = "90px";
    headerRow.insertBefore(th, firstHeader || null);
  }

  doctypeListRows(table).forEach((row) => {
    const firstCell = row.cells[0] as HTMLTableCellElement | undefined;
    if (firstCell?.dataset.serialColumn === "true") return;
    const td = document.createElement("td");
    td.dataset.serialColumn = "true";
    row.insertBefore(td, firstCell || null);
  });
}

function updateSerialNumbers(rows: HTMLTableRowElement[]) {
  rows.forEach((row, index) => {
    const serialCell = row.cells[0] as HTMLTableCellElement | undefined;
    if (serialCell?.dataset.serialColumn === "true") setTextIfChanged(serialCell, String(index + 1));
  });
}

function doctypeToolbarFor(table: HTMLTableElement) {
  const parent = table.parentElement;
  if (!parent) return null;
  return Array.from(parent.children).find((child) => child.classList.contains("doctype-list-toolbar")) as HTMLElement | undefined || null;
}

function applyDoctypeListState(table: HTMLTableElement) {
  if (!shouldShowDoctypeListToolbar(table)) return;

  const rows = doctypeListRows(table);
  const toolbar = doctypeToolbarFor(table);
  const searchInput = toolbar?.querySelector<HTMLInputElement>('input[data-doctype-search="true"]');
  const loadButton = toolbar?.querySelector<HTMLButtonElement>('button[data-doctype-load-more="true"]');
  const status = toolbar?.querySelector<HTMLElement>('[data-doctype-count="true"]');

  const query = (searchInput?.value || table.dataset.doctypeSearch || "").trim().toLowerCase();
  const limit = Number(table.dataset.doctypeVisibleLimit || 25);
  const matchingRows = rows.filter((row) => !query || row.innerText.toLowerCase().includes(query));

  rows.forEach((row) => {
    if (row.style.display !== "none") row.style.display = "none";
  });

  const visibleRows = matchingRows.slice(0, limit);
  visibleRows.forEach((row) => {
    if (row.style.display !== "") row.style.display = "";
  });
  updateSerialNumbers(visibleRows);

  const remainingRows = Math.max(0, matchingRows.length - visibleRows.length);
  if (loadButton) {
    const disabled = remainingRows === 0;
    if (loadButton.disabled !== disabled) loadButton.disabled = disabled;
    setTextIfChanged(loadButton, remainingRows > 0 ? `Load more (${remainingRows} more)` : "All loaded");
  }
  if (status) {
    setTextIfChanged(status, `${visibleRows.length} of ${matchingRows.length} shown`);
  }
}

function ensureDoctypeListToolbar(table: HTMLTableElement, headerRow: HTMLTableRowElement) {
  if (!shouldShowDoctypeListToolbar(table)) return;

  const wrap = table.closest(".table-wrap") || table.parentElement;
  if (!wrap) return;

  const toolbar = document.createElement("div");
  toolbar.className = "adjustable-table-toolbar doctype-list-toolbar";

  const searchLabel = document.createElement("label");
  searchLabel.textContent = "Global search";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search list...";
  searchInput.dataset.doctypeSearch = "true";
  searchInput.addEventListener("input", () => {
    table.dataset.doctypeSearch = searchInput.value;
    table.dataset.doctypeVisibleLimit = "25";
    applyDoctypeListState(table);
  });
  searchLabel.appendChild(searchInput);

  const label = document.createElement("label");
  label.textContent = "Sort by";

  const select = document.createElement("select");
  const columns = columnLabels(headerRow);
  columns.forEach((column) => {
    const option = document.createElement("option");
    option.value = String(column.index);
    option.textContent = column.label;
    select.appendChild(option);
  });
  label.appendChild(select);

  const directionButton = document.createElement("button");
  directionButton.type = "button";
  directionButton.className = "secondary";
  directionButton.textContent = "Ascending ↑";
  let direction: "asc" | "desc" = "asc";

  const applySort = () => {
    const columnIndex = Number(select.value || 0);
    sortTable(table, columnIndex, direction);
    Array.from(headerRow.cells).forEach((header) => {
      header.removeAttribute("data-sort-direction");
      header.classList.remove("sorted-column");
    });
    const activeHeader = headerRow.cells[columnIndex] as HTMLTableCellElement | undefined;
    if (activeHeader) {
      activeHeader.dataset.sortDirection = direction;
      activeHeader.classList.add("sorted-column");
      const button = activeHeader.querySelector<HTMLButtonElement>(".table-sort-button");
      if (button) setTextIfChanged(button, `${columns.find((column) => column.index === columnIndex)?.label || button.textContent || ""} ${direction === "asc" ? "↑" : "↓"}`);
    }
    applyDoctypeListState(table);
  };

  select.addEventListener("change", applySort);
  directionButton.addEventListener("click", () => {
    direction = direction === "asc" ? "desc" : "asc";
    setTextIfChanged(directionButton, direction === "asc" ? "Ascending ↑" : "Descending ↓");
    applySort();
  });

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "secondary";
  loadButton.dataset.doctypeLoadMore = "true";
  loadButton.textContent = "Load more";
  loadButton.addEventListener("click", () => {
    table.dataset.doctypeVisibleLimit = String(Number(table.dataset.doctypeVisibleLimit || 25) + 25);
    applyDoctypeListState(table);
  });

  const count = document.createElement("span");
  count.className = "small";
  count.dataset.doctypeCount = "true";

  toolbar.append(searchLabel, label, directionButton, loadButton, count);
  if (Array.from(wrap.children).some((child) => child.classList.contains("doctype-list-toolbar"))) return;
  const previous = wrap.previousElementSibling as HTMLElement | null;
  if (previous?.classList.contains("doctype-list-toolbar")) return;

  if (wrap.classList.contains("panel") && table.parentElement === wrap) {
    wrap.insertBefore(toolbar, table);
  } else {
    wrap.parentElement?.insertBefore(toolbar, wrap);
  }
}

function enhanceTable(table: HTMLTableElement) {
  if (table.classList.contains("adjustable-data-table")) return;
  if (!shouldShowDoctypeListToolbar(table)) return;

  const headerRow = table.tHead?.rows[0];
  if (!headerRow) return;

  ensureSerialColumn(table, headerRow);
  if (table.dataset.enhancedListView === "1") {
    applyDoctypeListState(table);
    return;
  }

  ensureDoctypeListToolbar(table, headerRow);
  table.dataset.enhancedListView = "1";
  table.classList.add("enhanced-data-table");
  let dragIndex = -1;

  Array.from(headerRow.cells).forEach((cell, initialIndex) => {
    const th = cell as HTMLTableCellElement;
    if (th.dataset.serialColumn === "true") {
      th.draggable = false;
      th.title = "Serial number";
      return;
    }

    th.draggable = true;
    th.title = "Click to sort. Drag to move. Pull right edge to resize.";

    const label = th.textContent || `Column ${initialIndex + 1}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-sort-button";
    button.textContent = label.trim();
    th.textContent = "";
    th.appendChild(button);

    button.addEventListener("click", () => {
      const index = Array.from(headerRow.cells).indexOf(th);
      const next = th.dataset.sortDirection === "asc" ? "desc" : "asc";
      Array.from(headerRow.cells).forEach((header) => {
        header.removeAttribute("data-sort-direction");
        header.classList.remove("sorted-column");
      });
      th.dataset.sortDirection = next;
      th.classList.add("sorted-column");
      setTextIfChanged(button, `${label.trim()} ${next === "asc" ? "↑" : "↓"}`);
      sortTable(table, index, next);
      applyDoctypeListState(table);
    });

    th.addEventListener("dragstart", () => {
      dragIndex = Array.from(headerRow.cells).indexOf(th);
    });
    th.addEventListener("dragover", (event) => event.preventDefault());
    th.addEventListener("drop", () => {
      const targetIndex = Array.from(headerRow.cells).indexOf(th);
      moveColumn(table, dragIndex, targetIndex);
      dragIndex = -1;
      applyDoctypeListState(table);
    });

    const resizer = document.createElement("span");
    resizer.className = "column-resizer";
    th.appendChild(resizer);
    resizer.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = th.offsetWidth;
      const onMove = (moveEvent: MouseEvent) => {
        th.style.width = `${Math.max(90, startWidth + moveEvent.clientX - startX)}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });

  applyDoctypeListState(table);
}

export default function GlobalDataTableEnhancer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const enhanceAll = () => {
      document.querySelectorAll<HTMLElement>(".global-table-toolbar").forEach((toolbar) => toolbar.remove());
      document.querySelectorAll<HTMLTableElement>("table.data-table").forEach(enhanceTable);
    };
    let pending = false;
    const scheduleEnhance = () => {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        enhanceAll();
      });
    };
    enhanceAll();
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, searchParams]);

  return null;
}
