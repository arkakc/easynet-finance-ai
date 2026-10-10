import Link from "next/link";
import type { ReactNode } from "react";

export type LinkedReferenceKind =
  | "journal" | "salesQuote" | "salesOrder" | "salesInvoice"
  | "supplierQuote" | "purchaseOrder" | "supplierBill"
  | "purchaseReceipt" | "deliveryNote" | "stockMovement"
  | "customer" | "supplier" | "project" | "item";

const base: Record<LinkedReferenceKind, string> = {
  journal: "/journals/",
  salesQuote: "/transactions/quote/",
  salesOrder: "/transactions/quote/",
  salesInvoice: "/transactions/invoice/",
  supplierQuote: "/transactions/purchaseOrder/",
  purchaseOrder: "/transactions/purchaseOrder/",
  supplierBill: "/transactions/supplierBill/",
  purchaseReceipt: "/transactions/purchaseReceipt/",
  deliveryNote: "/transactions/deliveryNote/",
  stockMovement: "/stock/movement/",
  customer: "/customers/",
  supplier: "/suppliers/",
  project: "/projects/master/",
  item: "/stock/item/",
};

/** Use only for confirmed existing references. A missing ID is never a broken link. */
export default function LinkedDocumentReference({ kind, id, children, className = "" }: {
  kind: LinkedReferenceKind;
  id: string | null | undefined;
  children?: ReactNode;
  className?: string;
}) {
  const ref = String(id || "").trim();
  if (!ref) return <span className="linked-reference-empty">—</span>;
  return <Link prefetch={false} className={`linked-document-id ${className}`.trim()} href={base[kind] + encodeURIComponent(ref)}>{children || ref}</Link>;
}
