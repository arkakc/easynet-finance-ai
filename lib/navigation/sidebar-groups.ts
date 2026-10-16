import type { Permission } from "@/lib/auth";

export type NavItem = readonly [label: string, href: string, permission: Permission];
export type NavGroup = { label: string; icon: string; links: readonly NavItem[] };

export const groups: readonly NavGroup[] = [
  { label: "Home", icon: "🏠", links: [["Home", "/home", "dashboard.read"]] },
  {
    label: "Dashboard",
    icon: "📊",
    links: [
      ["Home Workspace", "/workspace/home", "dashboard.read"],
      ["Management Dashboard", "/dashboard", "dashboard.read"],
      ["Control Centre", "/controls", "dashboard.read"],
      ["Approvals", "/approvals", "post.approve"],
    ],
  },
  {
    label: "Sales",
    icon: "💼",
    links: [
      ["Sales Workspace", "/workspace/sales", "sales.read"],
      ["Sales Transactions", "/transactions?module=sales", "sales.read"],
      ["Sales Returns", "/sales/returns", "sales.read"],
      ["Bulk Processing", "/sales/bulk-processing", "sales.read"],
      ["Bulk Sales Invoices", "/sales/bulk-invoices", "sales.read"],
      ["Customers", "/customers", "sales.read"],
      ["Projects", "/projects/master", "sales.read"],
      ["Retail POS Terminal", "/pos", "sales.read"],
      ["Payment Schedules", "/payment-schedules", "sales.read"],
    ],
  },
  {
    label: "Purchase",
    icon: "🛒",
    links: [
      ["Purchases Workspace", "/workspace/purchases", "purchase.read"],
      ["Purchase Transactions", "/transactions?module=purchase", "purchase.read"],
      ["Suppliers", "/suppliers", "purchase.read"],
      ["Projects", "/projects/master", "purchase.read"],
      ["Expenses", "/transactions?module=expense", "purchase.write"],
    ],
  },
  {
    label: "Stock & Assets",
    icon: "📦",
    links: [
      ["Inventory Workspace", "/workspace/inventory", "stock.read"],
      ["Items & Stock", "/stock", "stock.read"],
      ["Warehouse Stock", "/stock/warehouses", "stock.read"],
      ["Fixed Assets", "/assets", "stock.read"],
    ],
  },
  {
    label: "Accounts",
    icon: "📑",
    links: [
      ["Accounting Workspace", "/workspace/accounting", "accounts.read"],
      ["Banking Workspace", "/workspace/banking", "accounts.read"],
      ["Chart of Accounts", "/accounts", "accounts.read"],
      ["Document Relationship Explorer", "/document-explorer", "dashboard.read"],
      ["Manual Journal Entry", "/manual-journal-entry", "accounts.write"],
      ["Posted Journals", "/journals", "accounts.read"],
      ["Bank / Cash Pay Entry", "/bank-cash-pay", "accounts.write"],
      ["Payroll Control Centre", "/payroll", "accounts.read"],
      ["Journal Reversal", "/journals/reverse", "accounts.write"],
      ["Statements", "/statements", "accounts.read"],
      ["Bank Reconciliation", "/banking", "accounts.read"],
      ["Deferred Revenue", "/deferred-revenue", "post.approve"],
      ["Month-End Close", "/period-close", "post.approve"],
      ["Budgets", "/budgets", "accounts.read"],
      ["Loan Register", "/loans", "accounts.read"],
      ["Loan Actions", "/loans/actions", "accounts.write"],
    ],
  },
  {
    label: "Projects",
    icon: "🏗️",
    links: [["Projects Workspace", "/workspace/projects", "dashboard.read"], ["Projects", "/projects", "dashboard.read"]],
  },
  {
    label: "Reports",
    icon: "📈",
    links: [
      ["Reports Workspace", "/workspace/reports", "reports.read"],
      ["Financial Reports", "/reports", "reports.read"],
      ["General Ledger", "/reports/general-ledger", "reports.read"],
      ["Trial Balance", "/reports/trial-balance", "reports.read"],
      ["Cash Flow", "/reports/cashflow", "reports.read"],
      ["GST Report", "/reports/gst", "reports.read"],
    ],
  },
  {
    label: "Documents & AI",
    icon: "✨",
    links: [
      ["Source Documents", "/documents", "accounts.read"],
      ["AI Document Upload", "/ai-finance/upload", "accounts.write"],
    ],
  },
  {
    label: "Administration",
    icon: "⚙️",
    links: [
      ["Finance Settings", "/settings", "settings.manage"],
      ["Subledger Recovery", "/migration/subledger", "settings.manage"],
      ["Opening AR/AP Import", "/migration/opening-subledger", "settings.manage"],
      ["Go-Live Readiness", "/go-live", "settings.manage"],
      ["Backup & Recovery", "/system/backups", "settings.manage"],
      ["Users & Permissions", "/users", "users.manage"],
    ],
  },
] as const;

