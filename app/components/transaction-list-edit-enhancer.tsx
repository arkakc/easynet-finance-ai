"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function enhanceDocumentLists() {
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table.data-table"));

  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")).map((cell) => cell.textContent?.trim() || "");
    const idIndex = headers.findIndex((value) => value === "ID / Number");
    if (idIndex < 0) continue;

    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    for (const row of rows) {
      const cells = row.querySelectorAll<HTMLTableCellElement>("td");
      if (cells.length <= idIndex) continue;

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
