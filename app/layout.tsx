import "./globals.css";
import "./busy-controls.css";
import { getCurrentUser, hasPermission, type Permission } from "@/lib/auth";
import FlowReturnBridge from "@/app/components/flow-return-bridge";
import SetupAccessGuard from "@/app/components/setup-access-guard";
import SidebarShell from "@/app/components/sidebar-shell";
import ProfileMenu from "@/app/components/profile-menu";
import { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";
import GlobalDataTableEnhancer from "@/app/components/global-data-table-enhancer";
import GlobalFormDraftCache from "@/app/components/global-form-draft-cache";
import { getSetupGateState } from "@/lib/setup-gate";

export const metadata = {
  title: "Easynet Finance AI",
  description: "Finance control and AI accounting automation for Easynet IT Solutions Limited",
  robots: { index: false, follow: false, noarchive: true },
};

type NavItem = readonly [label: string, href: string, permission: Permission];
type NavGroup = { label: string; icon: string; links: readonly NavItem[] };

const groups: readonly NavGroup[] = [
  {
    label: "Dashboard",
    icon: "📊",
    links: [
      ["Management Dashboard", "/dashboard", "dashboard.read"],
      ["Control Centre", "/controls", "dashboard.read"],
      ["Approvals", "/approvals", "post.approve"],
    ],
  },
  {
    label: "Sales",
    icon: "💼",
    links: [
      ["Sales Transactions", "/transactions?module=sales", "sales.read"],
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
      ["Items & Stock", "/stock", "stock.read"],
      ["Fixed Assets", "/assets", "stock.read"],
    ],
  },
  {
    label: "Accounts",
    icon: "📑",
    links: [
      ["Chart of Accounts", "/accounts", "accounts.read"],
      ["Document Relationship Explorer", "/document-explorer", "dashboard.read"],
      ["Manual Journal Entry", "/manual-journal-entry", "accounts.write"],
      ["Posted Journals", "/journals", "accounts.read"],
      ["Bank / Cash Pay Entry", "/bank-cash-pay", "accounts.write"],
      ["Payroll Control Centre", "/payroll", "accounts.read"],
      ["Journal Reversal", "/journals/reverse", "accounts.write"],
      ["Statements", "/statements", "accounts.read"],
      ["Bank Reconciliation", "/banking", "accounts.read"],
      ["Month-End Close", "/period-close", "post.approve"],
      ["Budgets", "/budgets", "accounts.read"],
      ["Loan Register", "/loans", "accounts.read"],
      ["Loan Actions", "/loans/actions", "accounts.write"],
    ],
  },
  {
    label: "Projects",
    icon: "🏗️",
    links: [["Projects", "/projects", "dashboard.read"]],
  },
  {
    label: "Reports",
    icon: "📈",
    links: [
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const { setupActive, openingSubledgerLocked } = user ? await getSetupGateState() : { setupActive: true, openingSubledgerLocked: false };
  const navGroups: SidebarNavGroup[] = !user ? [] : !setupActive ? [
    { label: "System Setup", icon: "⚙️", links: [{ label: "Fresh Setup Wizard", href: "/setup/finance" }] },
  ] : groups.flatMap((group) => {
    const visible = group.links
      .filter(([, , permission]) => hasPermission(user, permission))
      .map(([label, href]) => ({
        label,
        href,
        disabled: href === "/migration/opening-subledger" && openingSubledgerLocked,
        disabledReason: "Disabled because the system was activated as a new business with zero opening balances. Full reset is required to enable opening AR/AP import again.",
      }));
    return visible.length ? [{ label: group.label, icon: group.icon, links: visible }] : [];
  });
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        {!user ? (
          children
        ) : (
          <div className="shell">
            <SidebarShell
              groups={navGroups}
              homeHref={setupActive ? "/dashboard" : "/setup/finance"}
            />
            <ProfileMenu userName={user.name} userRoles={user.roles} />
            <main className="main">
              <SetupAccessGuard setupActive={setupActive} />
              <FlowReturnBridge />
              <GlobalDataTableEnhancer />
              <GlobalFormDraftCache />
              {children}
            </main>
          </div>
        )}
      </body>
    </html>
  );
}
