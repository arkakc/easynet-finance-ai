import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Easynet Finance AI",
  description: "Finance control and AI accounting automation for Easynet IT Solutions Limited",
};

const groups = [
  {
    label: "Overview",
    links: [
      ["Dashboard", "/dashboard"],
      ["Control Centre", "/controls"],
      ["Commercial Approvals", "/approvals"],
    ],
  },
  {
    label: "Operations",
    links: [
      ["Transactions", "/transactions"],
      ["Document Conversions", "/conversions"],
      ["Payment Schedules", "/payment-schedules"],
      ["Business Masters", "/masters"],
      ["Projects", "/projects"],
      ["Items & Stock", "/stock"],
      ["Fixed Assets", "/assets"],
    ],
  },
  {
    label: "Accounting",
    links: [
      ["Chart of Accounts", "/accounts"],
      ["Loan Register", "/loans"],
      ["Loan Actions", "/loans/actions"],
      ["Posted Journals", "/journals"],
      ["Journal Reversal", "/journals/reverse"],
      ["Statements", "/statements"],
      ["Budgets", "/budgets"],
    ],
  },
  {
    label: "Reports",
    links: [
      ["Financial Reports", "/reports"],
      ["Cash Flow", "/reports/cashflow"],
      ["GST Report", "/reports/gst"],
    ],
  },
  {
    label: "AI & Evidence",
    links: [
      ["AI Document Upload", "/ai-finance/upload"],
      ["Source Documents", "/documents"],
      ["Finance Settings", "/settings"],
    ],
  },
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link className="brand" href="/dashboard">
              <strong>EASYNET FINANCE AI</strong>
              <span>Finance Control MVP</span>
            </Link>
            <nav>
              {groups.map((group) => (
                <div className="nav-section" key={group.label}>
                  <div className="nav-label">{group.label}</div>
                  {group.links.map(([label, href]) => (
                    <Link href={href} key={href}>{label}</Link>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
