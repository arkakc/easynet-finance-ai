import { safeDocumentHref } from "@/lib/documents/safe-document-links";

export type SuggestedAction = { key: string; label: string; description: string; href: string; priority: number };
type Input = { type: string; status: string; id: string; number?: string; partyType?: string; links: Array<{ type?: string; href?: string; direction?: string; label?: string }> };
const finished = new Set(["CANCELLED", "REVERSED", "VOID", "REJECTED"]);
const actionable = new Set(["APPROVED", "SENT", "ACCEPTED", "PART_RECEIVED", "RECEIVED", "PART_BILLED", "CONVERTED"]);
function available(href: string) { return safeDocumentHref(href); }
export function suggestNextActions(input: Input): SuggestedAction[] {
  const status = input.status.toUpperCase();
  if (finished.has(status) || !input.id.trim()) return [];
  const id = encodeURIComponent(input.id);
  const num = String(input.number || "").toUpperCase();
  const linked = input.links.filter(row => row.direction === "next" && available(String(row.href || "")));
  const action: SuggestedAction[] = [];
  const add = (key: string, label: string, description: string, href: string, priority: number) => {
    if (!action.some(row => row.key === key)) action.push({ key, label, description, href, priority });
  };
  const linkedOf = (pattern: RegExp) => linked.find(row => pattern.test(String(row.type || "") + " " + String(row.label || "") + " " + String(row.href || "")));
  if (input.type === "quote" && !num.startsWith("SO-") && actionable.has(status)) {
    const existing = linkedOf(/sales.order|\/transactions\/quote\//i);
    if (existing?.href) add("existing-order", "Open Sales Order", "This quotation already has a linked downstream sales document.", existing.href, 10);
    else add("sales-order", "Sales Order workflow", "Create the Sales Order through the controlled quotation conversion flow below.", "#document-actions", 20);
  }
  if (input.type === "purchaseOrder" && num.startsWith("SUPQ-") && actionable.has(status)) {
    const existing = linkedOf(/purchase.order|\/transactions\/purchaseOrder\//i);
    if (existing?.href) add("existing-po", "Open Purchase Order", "Reuse the existing converted Purchase Order.", existing.href, 10);
    else add("po", "Purchase Order workflow", "Convert this supplier quotation using the existing checked purchase workflow.", "#document-actions", 20);
  }
  if (input.type === "purchaseOrder" && !num.startsWith("SUPQ-") && actionable.has(status)) {
    const receipt = linkedOf(/receipt|grn/i);
    if (receipt?.href) add("existing-receipt", "Open Purchase Receipt", "Continue processing an existing GRN.", receipt.href, 10);
    else add("receipt", "Purchase Receipt workflow", "Review available stock quantities before creating a GRN.", "#document-actions", 20);
    const bill = linkedOf(/supplier.invoice|supplier.bill|\/supplierBill\//i);
    if (bill?.href) add("existing-bill", "Open Supplier Invoice", "Avoid entering this linked supplier invoice again.", bill.href, 11);
  }
  if (input.type === "invoice" && ["POSTED", "PARTLY_PAID", "PARTIAL"].includes(status)) {
    add("receipt", "Receive Customer Payment", "Use the invoice reference to preselect the customer settlement document.", `/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=${id}`, 20);
  }
  if (input.type === "supplierBill" && ["POSTED", "PARTLY_PAID", "PARTIAL"].includes(status)) {
    add("payment", "Create Supplier Payment", "Carry the source bill reference into the existing payment workflow.", `/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${id}`, 20);
  }
  return action.sort((a, b) => a.priority - b.priority);
}
