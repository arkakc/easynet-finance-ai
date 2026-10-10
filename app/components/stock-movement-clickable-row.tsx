"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export default function StockMovementClickableRow({ movementId, children }: { movementId: string; children: ReactNode }) {
  const router = useRouter();
  const href = `/stock/movement/${encodeURIComponent(movementId)}`;
  const isInteractive = (element: EventTarget | null) =>
    element instanceof Element && Boolean(element.closest("a,button,input,select,textarea,summary"));
  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    if (!isInteractive(event.target) && !event.defaultPrevented) router.push(href);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (isInteractive(event.target)) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }
  return <tr className="stock-trace-clickable-row" tabIndex={0} role="link" aria-label={`Open stock movement ${movementId}`} onClick={onClick} onKeyDown={onKeyDown}>{children}</tr>;
}
