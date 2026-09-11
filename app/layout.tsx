import "./globals.css";
import "./busy-controls.css";
import Link from "next/link";
import { getCurrentUser, hasPermission, type Permission } from "@/lib/auth";
import LogoutButton from "@/app/components/logout-button";
import FlowReturnBridge from "@/app/components/flow-return-bridge";

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
      ["Retail POS Terminal", "/pos", "sales.read"],
      ["Customers", "/masters?tab=customers", "sales.read"],
      ["Payment Schedules", "/payment-schedules", "sales.read"],
    ],
  },
  {
    label: "Purchase",
    icon: "🛒",
    links: [
      ["Purchase Transactions", "/transactions?module=purchase", "purchase.read"],
      ["Suppliers", "/masters?tab=suppliers", "purchase.read"],
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
      ["Posted Journals", "/journals", "accounts.read"],
      ["Journal Reversal", "/journals/reverse", "accounts.write"],
      ["Statements", "/statements", "accounts.read"],
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
      ["Business Masters", "/masters", "settings.manage"],
      ["Finance Settings", "/settings", "settings.manage"],
      ["Users & Permissions", "/users", "users.manage"],
    ],
  },
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
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
            <aside className="sidebar">
              <Link prefetch={false} className="brand" href="/dashboard">
                <div className="brand-icon">EN</div>
                <div>
                  <strong>EASYNET FINANCE AI</strong>
                  <span>Enterprise Mini ERP · PGK</span>
                </div>
              </Link>
              <nav>
                {groups.map((group) => {
                  const visible = group.links.filter(([, , permission]) => hasPermission(user, permission));
                  if (!visible.length) return null;
                  return (
                    <div className="nav-section" key={group.label}>
                      <div className="nav-label">
                        <span className="nav-section-icon">{group.icon}</span>
                        <span>{group.label}</span>
                      </div>
                      {visible.map(([label, href]) => (
                        <Link prefetch={false} href={href} key={`${group.label}-${label}`}>
                          {label}
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </nav>
              <div className="sidebar-user">
                <div className="sidebar-user-header">
                  <div className="sidebar-user-avatar">
                    {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                  </div>
                  <div className="sidebar-user-info">
                    <strong>{user.name}</strong>
                    <span>{user.roles.join(", ")}</span>
                  </div>
                </div>
                <LogoutButton />
              </div>
            </aside>
            <main className="main">
              <FlowReturnBridge />
              {children}
            </main>
          </div>
        )}
      </body>
    </html>
  );
}
