import type { Permission } from "@/lib/auth";

export type WorkspaceId = "home" | "sales" | "purchases" | "banking" | "inventory" | "accounting" | "projects" | "reports";
export type WorkspaceAction = { title: string; description: string; href: string; section: string; permission: Permission; kind?: "primary" | "action"; disabled?: boolean; disabledReason?: string };
export type WorkspaceDefinition = { id: WorkspaceId; title: string; eyebrow: string; description: string; permission: Permission; actions: readonly WorkspaceAction[] };

const transaction = (module: "sales" | "purchase", tab: string, mode: "list" | "create" = "list") =>
  `/transactions?module=${module}&tab=${tab}&mode=${mode}`;

export const workspaces: Record<WorkspaceId, WorkspaceDefinition> = {
  home: { id: "home", title: "Dashboard", eyebrow: "YOUR DAILY WORK", description: "Open today's financial overview, approvals and outstanding work from one place.", permission: "dashboard.read", actions: [
    { title: "Management Dashboard", description: "Posted balances, GST, receivables and payables", href: "/dashboard", section: "Overview", permission: "dashboard.read", kind: "primary" },
    { title: "Control Centre", description: "Reconciliation exceptions and financial controls", href: "/controls", section: "Overview", permission: "dashboard.read" },
    { title: "Approvals", description: "Review documents awaiting approval", href: "/approvals", section: "Tasks", permission: "post.approve" },
    { title: "Recent Journals", description: "Check posted accounting transactions", href: "/journals", section: "Tasks", permission: "accounts.read" },
  ]},
  sales: { id: "sales", title: "Sales", eyebrow: "CUSTOMER JOURNEY", description: "Quotation → Sales Order → Delivery → Invoice → Customer Receipt", permission: "sales.read", actions: [
    { title: "Sales Quotations", description: "Create offers and review customer quotations", href: transaction("sales", "salesQuote"), section: "Quotations", permission: "sales.read", kind: "primary" },
    { title: "New Sales Quotation", description: "Start a new customer offer", href: transaction("sales", "salesQuote", "create"), section: "Quotations", permission: "sales.write", kind: "action" },
    { title: "Sales Orders", description: "Manage confirmed customer commitments", href: transaction("sales", "salesOrder"), section: "Orders", permission: "sales.read" },
    { title: "Deliveries", description: "Stock issues and delivery notes", href: transaction("sales", "deliveryNote"), section: "Deliveries", permission: "sales.read" },
    { title: "Sales Invoices", description: "Posted invoices, outstanding and GST", href: transaction("sales", "salesInvoice"), section: "Invoices", permission: "sales.read" },
    { title: "Customer Receipts", description: "Record receipts and allocate invoice payments", href: transaction("sales", "salesPayment"), section: "Receipts", permission: "sales.read" },
    { title: "Bulk Processing", description: "Preview and convert approved quotations in controlled batches", href: "/sales/bulk-processing", section: "Registers", permission: "sales.read" },
    { title: "Bulk Delivery Notes", description: "Create draft delivery notes from approved sales orders in batches", href: "/sales/bulk-deliveries", section: "Registers", permission: "sales.read" },
    { title: "Bulk Sales Invoices", description: "Generate draft invoices from fulfilled sales orders", href: "/sales/bulk-invoices", section: "Registers", permission: "sales.read" },
    { title: "Bulk Invoice Approval", description: "Review and post draft invoices with controller approval", href: "/sales/bulk-invoice-approval", section: "Registers", permission: "post.approve" },
    { title: "Bulk Customer Allocations", description: "Allocate existing customer advances to posted Sales Invoices", href: "/sales/bulk-allocations", section: "Receipts", permission: "sales.read" },
    { title: "Sales Returns", description: "Invoice-linked partial returns and draft credit notes", href: "/sales/returns", section: "Returns", permission: "sales.read" },
    { title: "Customers", description: "Customer master and contact records", href: "/customers", section: "Masters", permission: "sales.read" },
    { title: "Payment Schedules", description: "Customer payment schedules and deferred revenue", href: "/payment-schedules", section: "Receipts", permission: "sales.read" },
  ]},
  purchases: { id: "purchases", title: "Purchases", eyebrow: "SUPPLIER JOURNEY", description: "Supplier Quotation → Purchase Order → GRN → Supplier Bill → Payment", permission: "purchase.read", actions: [
    { title: "Supplier Quotations", description: "Compare and convert supplier offers", href: transaction("purchase", "supplierQuote"), section: "Quotations", permission: "purchase.read", kind: "primary" },
    { title: "New Supplier Quotation", description: "Start a new supplier quotation", href: transaction("purchase", "supplierQuote", "create"), section: "Quotations", permission: "purchase.write", kind: "action" },
    { title: "Purchase Orders", description: "Ordered goods and outstanding commitments", href: transaction("purchase", "purchaseOrder"), section: "Orders", permission: "purchase.read" },
    { title: "Goods Receipts (GRN)", description: "Warehouse receiving and GRNI", href: transaction("purchase", "purchaseReceipt"), section: "Receipts", permission: "purchase.read" },
    { title: "Supplier Bills", description: "Three-way match, input GST and accounts payable", href: transaction("purchase", "supplierInvoice"), section: "Bills", permission: "purchase.read" },
    { title: "Supplier Payments", description: "Supplier advances, allocations and settlement", href: transaction("purchase", "purchasePayment"), section: "Payments", permission: "purchase.read" },
    { title: "Suppliers", description: "Supplier master and contacts", href: "/suppliers", section: "Masters", permission: "purchase.read" },
    { title: "Expenses", description: "Other operating purchase costs", href: "/transactions?module=expense&tab=expense&mode=list", section: "Bills", permission: "purchase.write" },
  ]},
  banking: { id: "banking", title: "Banking", eyebrow: "CASH MANAGEMENT", description: "Bank ledger, receive/spend money and statement reconciliation.", permission: "accounts.read", actions: [
    { title: "Bank Register & Reconciliation", description: "Bank accounts, statement import and matching", href: "/banking", section: "Bank Register", permission: "accounts.read", kind: "primary" },
    { title: "Bank / Cash Pay Entry", description: "Transfer, receive or spend cash with controls", href: "/bank-cash-pay", section: "Payments", permission: "accounts.write" },
    { title: "Customer Receipts", description: "Receipts allocated to posted customer invoices", href: transaction("sales", "salesPayment"), section: "Payments", permission: "sales.read" },
    { title: "Supplier Payments", description: "Settlement of approved supplier liabilities", href: transaction("purchase", "purchasePayment"), section: "Payments", permission: "purchase.read" },
    { title: "Cash Flow Report", description: "View cash movements and liquidity", href: "/reports/cashflow", section: "Reports", permission: "reports.read" },
  ]},
  inventory: { id: "inventory", title: "Inventory", eyebrow: "STOCK & VALUATION", description: "Item master, warehouse stock, stock movements and valuation.", permission: "stock.read", actions: [
    { title: "Items & Stock", description: "Item master, stock details and movement ledger", href: "/stock", section: "Items", permission: "stock.read", kind: "primary" },
    { title: "New Item", description: "Create a stock item or service", href: "/stock/new-item", section: "Items", permission: "stock.write", kind: "action" },
    { title: "Warehouse Stock", description: "Warehouse-wise stock and availability", href: "/stock/warehouses", section: "Warehouses", permission: "stock.read" },
    { title: "Goods Receipts", description: "Receive items against purchase orders", href: transaction("purchase", "purchaseReceipt"), section: "Movements", permission: "purchase.read" },
    { title: "Delivery Notes", description: "Issue goods against sales orders", href: transaction("sales", "deliveryNote"), section: "Movements", permission: "sales.read" },
    { title: "Fixed Assets", description: "Asset register and tracking", href: "/assets", section: "Assets", permission: "stock.read" },
  ]},
  accounting: { id: "accounting", title: "Accounting", eyebrow: "FINANCIAL CONTROLS", description: "General ledger, journals, tax controls and period closing.", permission: "accounts.read", actions: [
    { title: "Chart of Accounts", description: "Accounts and linked posting codes", href: "/accounts", section: "General Ledger", permission: "accounts.read", kind: "primary" },
    { title: "Posted Journals", description: "Inspect posted journal lines and source documents", href: "/journals", section: "General Ledger", permission: "accounts.read" },
    { title: "New Manual Journal", description: "Create a controlled journal entry", href: "/manual-journal-entry", section: "General Ledger", permission: "accounts.write", kind: "action" },
    { title: "Financial Statements", description: "Profit & Loss and Balance Sheet", href: "/reports", section: "Reports", permission: "reports.read" },
    { title: "Trial Balance", description: "Check debit and credit balances", href: "/reports/trial-balance", section: "Reports", permission: "reports.read" },
    { title: "GST Report", description: "Output/Input GST and related evidence", href: "/reports/gst", section: "Tax", permission: "reports.read" },
    { title: "Month-End Close", description: "Period locks and closing readiness", href: "/period-close", section: "Period Close", permission: "post.approve" },
    { title: "Bank Reconciliation", description: "Match bank statement and GL balances", href: "/banking", section: "Period Close", permission: "accounts.read" },
  ]},
  projects: { id: "projects", title: "Projects", eyebrow: "PROJECT PERFORMANCE", description: "Project master, expenses and profitability in one starting point.", permission: "dashboard.read", actions: [
    { title: "Project Overview", description: "Project costs, revenue and financial position", href: "/projects", section: "Overview", permission: "dashboard.read", kind: "primary" },
    { title: "Project Register", description: "Search, create and manage project master records", href: "/projects/master", section: "Master Data", permission: "sales.read" },
    { title: "Project Purchasing", description: "Purchase orders and bills allocated to projects", href: transaction("purchase", "purchaseOrder"), section: "Transactions", permission: "purchase.read" },
    { title: "Project Sales", description: "Sales orders and invoices with project references", href: transaction("sales", "salesOrder"), section: "Transactions", permission: "sales.read" },
  ]},
  reports: { id: "reports", title: "Reports", eyebrow: "FINANCIAL REPORTING", description: "Financial statements, GST, ledger detail and cash-flow reporting.", permission: "reports.read", actions: [
    { title: "Financial Statements", description: "Profit & Loss, Balance Sheet and AR/AP controls", href: "/reports", section: "Financial", permission: "reports.read", kind: "primary" },
    { title: "General Ledger", description: "Trace journal activity and balances", href: "/reports/general-ledger", section: "Financial", permission: "reports.read" },
    { title: "Trial Balance", description: "Debit and credit reconciliation", href: "/reports/trial-balance", section: "Financial", permission: "reports.read" },
    { title: "Cash Flow", description: "Cash receipts and disbursements", href: "/reports/cashflow", section: "Cash", permission: "reports.read" },
    { title: "GST Report", description: "Tax control balances and returns", href: "/reports/gst", section: "Tax", permission: "reports.read" },
    { title: "Statements", description: "Customer and supplier account statements", href: "/statements", section: "Financial", permission: "accounts.read" },
  ]},
};

export const workspaceIds = Object.keys(workspaces) as WorkspaceId[];
export function workspaceFor(slug: string): WorkspaceDefinition | null {
  return Object.prototype.hasOwnProperty.call(workspaces, slug) ? workspaces[slug as WorkspaceId] : null;
}
