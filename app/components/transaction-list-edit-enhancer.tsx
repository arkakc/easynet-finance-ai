"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function ensureOldestFirst(table: HTMLTableElement, idIndex: number) {
  const tbody = table.tBodies.item(0);
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
  const documentRows = rows.filter((row) => {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    return cells.length > idIndex && Boolean(cells[idIndex].querySelector<HTMLAnchorElement>('a[href^="/transactions/"]'));
  });
  if (documentRows.length < 2) {
    const panel = table.closest(".panel");
    const badge = panel?.querySelector<HTMLElement>(".auto-badge");
    if (badge?.textContent?.includes("Newest first")) badge.textContent = badge.textContent.replace("Newest first", "Oldest first");
    return;
  }

  const signature = documentRows
    .map((row) => {
      const cells = row.querySelectorAll<HTMLTableCellElement>("td");
      return cells[idIndex].querySelector<HTMLAnchorElement>('a[href^="/transactions/"]')?.pathname || "";
    })
    .sort()
    .join("|");

  if (table.dataset.oldestFirstSignature !== signature) {
    // The workspace renders newest-first internally. Reverse each freshly rendered
    // document set once so the user-facing register remains chronological oldest-first.
    documentRows.reverse().forEach((row) => tbody.appendChild(row));
    table.dataset.oldestFirstSignature = signature;
  }

  const panel = table.closest(".panel");
  const badge = panel?.querySelector<HTMLElement>(".auto-badge");
  if (badge?.textContent?.includes("Newest first")) badge.textContent = badge.textContent.replace("Newest first", "Oldest first");
}

function enhanceDocumentLists() {
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table.data-table"));

  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")).map((cell) => cell.textContent?.trim() || "");
    const idIndex = headers.findIndex((value) => value === "ID / Number");
    const statusIndex = headers.findIndex((value) => value === "Status");
    const actionIndex = headers.findIndex((value) => value === "Action");
    if (idIndex < 0 || statusIndex < 0 || actionIndex < 0) continue;

    ensureOldestFirst(table, idIndex);

    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    for (const row of rows) {
      const cells = row.querySelectorAll<HTMLTableCellElement>("td");
      if (cells.length <= Math.max(idIndex, statusIndex, actionIndex)) continue;

      const documentLink = cells[idIndex].querySelector<HTMLAnchorElement>('a[href^="/transactions/"]');
      if (!documentLink) continue;

      const url = new URL(documentLink.href, window.location.origin);
      const path = url.pathname;
      const isSalesInvoice = path.startsWith("/transactions/invoice/");
      const currentLabel = (documentLink.textContent || "").trim();
      if (isSalesInvoice && currentLabel.toUpperCase().startsWith("CN-") && row.dataset.creditNoteLabeled !== "1") {
        documentLink.textContent = `Credit Note / Return · ${currentLabel}`;
        row.dataset.creditNoteLabeled = "1";
      }

      if (row.dataset.editEnhanced === "1") continue;
      const actionCell = cells[actionIndex];
      const status = (cells[statusIndex].textContent || "DRAFT").trim().toUpperCase().split(/\s+/)[0];
      const baseUrl = new URL(documentLink.href, window.location.origin);
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/edit`;

      const holder = actionCell.querySelector<HTMLElement>(".row-actions") || actionCell;
      if (status === "DRAFT" && row.dataset.creditNoteLabeled !== "1") {
        const edit = document.createElement("a");
        edit.href = `${baseUrl.pathname}${baseUrl.search}`;
        edit.textContent = "Edit";
        edit.className = "button-link secondary-link";
        edit.setAttribute("data-list-edit", "1");
        holder.appendChild(edit);
      } else {
        const locked = document.createElement("button");
        locked.type = "button";
        locked.disabled = true;
        locked.textContent = row.dataset.creditNoteLabeled === "1" ? "Controlled Credit Note" : "Edit Locked";
        locked.setAttribute("data-list-edit", "1");
        holder.appendChild(locked);
      }

      if (isSalesInvoice && row.dataset.creditNoteLabeled !== "1" && ["POSTED", "PARTLY_PAID"].includes(status)) {
        const invoiceId = decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
        if (invoiceId) {
          const payment = document.createElement("a");
          payment.href = `/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=${encodeURIComponent(invoiceId)}`;
          payment.textContent = "Receive Payment";
          payment.className = "button-link";
          payment.setAttribute("data-sales-payment", "1");
          holder.appendChild(payment);
        }
      }
      row.dataset.editEnhanced = "1";
    }
  }
}

export default function TransactionListEditEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/transactions") return;

    enhanceDocumentLists();
    const observer = new MutationObserver(() => enhanceDocumentLists());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
