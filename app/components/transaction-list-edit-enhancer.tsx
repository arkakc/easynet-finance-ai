"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function enhanceDocumentLists() {
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table.data-table"));

  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")).map((cell) => cell.textContent?.trim() || "");
    const idIndex = headers.findIndex((value) => value === "ID / Number");
    const statusIndex = headers.findIndex((value) => value === "Status");
    const actionIndex = headers.findIndex((value) => value === "Action");
    if (idIndex < 0 || statusIndex < 0 || actionIndex < 0) continue;

    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    for (const row of rows) {
      if (row.dataset.editEnhanced === "1") continue;
      const cells = row.querySelectorAll<HTMLTableCellElement>("td");
      if (cells.length <= Math.max(idIndex, statusIndex, actionIndex)) continue;

      const documentLink = cells[idIndex].querySelector<HTMLAnchorElement>('a[href^="/transactions/"]');
      if (!documentLink) continue;
      const actionCell = cells[actionIndex];
      const status = (cells[statusIndex].textContent || "DRAFT").trim().toUpperCase().split(/\s+/)[0];
      const baseUrl = new URL(documentLink.href, window.location.origin);
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/edit`;

      const holder = actionCell.querySelector<HTMLElement>(".row-actions") || actionCell;
      if (status === "DRAFT") {
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
        locked.textContent = "Edit Locked";
        locked.setAttribute("data-list-edit", "1");
        holder.appendChild(locked);
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
