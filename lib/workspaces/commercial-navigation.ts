import type { WorkspaceAction, WorkspaceId } from "@/lib/workspaces/module-registry";

export const COMMERCIAL_CATEGORY_ORDER = [
  "All", "Quotations", "Orders", "Fulfilment", "Billing",
  "Payments", "Returns", "Bulk Operations", "Registers", "Masters", "Projects",
] as const;

type CommercialCategory = Exclude<(typeof COMMERCIAL_CATEGORY_ORDER)[number], "All">;

export function commercialCategory(action: Pick<WorkspaceAction, "title" | "href" | "section">): CommercialCategory {
  const title = action.title.toLowerCase();
  const section = action.section.toLowerCase();
  const href = action.href.toLowerCase();
  // Classify by business operation, not by legacy navigation labels.
  if (/bulk|batch/.test(title) || /\/bulk-/.test(href)) return "Bulk Operations";
  if (/project/.test(title) || section === "projects") return "Projects";
  if (/return|credit note|debit note/.test(title) || section === "returns") return "Returns";
  if (/customer master|supplier master|^customers$|^suppliers$|^masters$/.test(title) || section === "masters") return "Masters";
  if (/reconciliation|report|transaction register|^sales transactions$|^purchase transactions$|retail pos|register|enquir|inquir/.test(title) || section === "registers") return "Registers";
  if (/quotation|quote/.test(title) || section === "quotations") return "Quotations";
  if (/order/.test(title) || section === "orders") return "Orders";
  if (/deliver|receipt of goods|goods receipt|\bgrn\b|fulfil|fulfill/.test(title) || ["deliveries", "receipts"].includes(section) && !/payment|customer receipt|cash receipt/i.test(title)) return "Fulfilment";
  if (/invoice|bill|expense/.test(title) || ["invoices", "bills"].includes(section)) return "Billing";
  if (/payment|customer receipt|cash receipt|allocation|settlement|schedule/.test(title) || ["payments"].includes(section)) return "Payments";
  return "Registers";
}

export function organizeCommercialActions(actions: readonly WorkspaceAction[], id: WorkspaceId): WorkspaceAction[] {
  if (id !== "sales" && id !== "purchases") return [...actions];
  const order = COMMERCIAL_CATEGORY_ORDER.slice(1);
  return actions.map(action => ({ ...action, section: commercialCategory(action) }))
    .sort((a, b) => order.indexOf(a.section as CommercialCategory) - order.indexOf(b.section as CommercialCategory));
}
