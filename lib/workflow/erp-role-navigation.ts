export type Capability = { name: string; actions: readonly string[] };
export type RoleNavigationLink = { label: string; href: string; resource: string; action: "READ" | "CREATE" };

const LINKS: readonly RoleNavigationLink[] = [
  { label: "Sales Invoices", href: "/transactions?module=sales", resource: "SALES_INVOICE", action: "READ" },
  { label: "Supplier Bills", href: "/transactions?module=purchase", resource: "SUPPLIER_BILL", action: "READ" },
  { label: "Purchase Orders", href: "/transactions?module=purchase", resource: "PURCHASE_ORDER", action: "READ" },
  { label: "Inventory Receipts", href: "/stock", resource: "GOODS_RECEIPT", action: "READ" },
  { label: "Journal Entry", href: "/manual-journal-entry", resource: "MANUAL_JOURNAL", action: "CREATE" },
  { label: "General Ledger", href: "/reports/general-ledger", resource: "GENERAL_LEDGER", action: "READ" },
  { label: "Financial Reports", href: "/reports", resource: "FINANCIAL_REPORTING", action: "READ" },
  { label: "Bank Reconciliation", href: "/banking", resource: "BANK_RECONCILIATION", action: "READ" },
];

/** Presentation only: backend endpoints must independently check privileges. */
export function permittedRoleNavigation(
  documentTypes: readonly Capability[], accountingFunctions: readonly Capability[],
): RoleNavigationLink[] {
  const permitted = new Map([...documentTypes, ...accountingFunctions].map(r=>[r.name, r.actions]));
  return LINKS.filter(link=>permitted.get(link.resource)?.includes(link.action));
}
