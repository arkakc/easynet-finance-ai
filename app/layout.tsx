import "./globals.css";
import "./busy-controls.css";
import Link from "next/link";
import { getCurrentUser, hasPermission, type Permission } from "@/lib/auth";
import LogoutButton from "@/app/components/logout-button";
import FlowReturnBridge from "@/app/components/flow-return-bridge";

export const metadata = { title: "Easynet Finance AI", description: "Finance control and AI accounting automation for Easynet IT Solutions Limited", robots: { index: false, follow: false, noarchive: true } };
type NavItem = readonly [label:string,href:string,permission:Permission];type NavGroup={label:string;links:readonly NavItem[]};
const groups:readonly NavGroup[]=[
{label:"Dashboard",links:[["Management Dashboard","/dashboard","dashboard.read"],["Control Centre","/controls","dashboard.read"],["Approvals","/approvals","post.approve"]]},
{label:"Sales",links:[["Sales Transactions","/transactions?module=sales","sales.read"],["Customers","/masters?tab=customers","sales.read"],["Sales Document Conversions","/conversions/sales","sales.write"],["Payment Schedules","/payment-schedules","sales.read"]]},
{label:"Purchase",links:[["Purchase Transactions","/transactions?module=purchase","purchase.read"],["Suppliers","/masters?tab=suppliers","purchase.read"],["Purchase Document Conversions","/conversions/purchase","purchase.write"],["Expenses","/transactions?module=expense","purchase.write"]]},
{label:"Stock & Assets",links:[["Items & Stock","/stock","stock.read"],["Fixed Assets","/assets","stock.read"]]},
{label:"Accounts",links:[["Chart of Accounts","/accounts","accounts.read"],["Posted Journals","/journals","accounts.read"],["Journal Reversal","/journals/reverse","accounts.write"],["Statements","/statements","accounts.read"],["Budgets","/budgets","accounts.read"],["Loan Register","/loans","accounts.read"],["Loan Actions","/loans/actions","accounts.write"]]},
{label:"Projects",links:[["Projects","/projects","dashboard.read"]]},
{label:"Reports",links:[["Financial Reports","/reports","reports.read"],["Cash Flow","/reports/cashflow","reports.read"],["GST Report","/reports/gst","reports.read"]]},
{label:"Documents & AI",links:[["Source Documents","/documents","accounts.read"],["AI Document Upload","/ai-finance/upload","accounts.write"]]},
{label:"Administration",links:[["Business Masters","/masters","settings.manage"],["Finance Settings","/settings","settings.manage"],["Users & Permissions","/users","users.manage"]]}
] as const;
export default async function RootLayout({children}:{children:React.ReactNode}){const user=await getCurrentUser();return <html lang="en"><body>{!user?children:<div className="shell"><aside className="sidebar"><Link className="brand" href="/dashboard"><strong>EASYNET FINANCE AI</strong><span>Finance ERP</span></Link><nav>{groups.map(group=>{const visible=group.links.filter(([, ,permission])=>hasPermission(user,permission));if(!visible.length)return null;return <div className="nav-section" key={group.label}><div className="nav-label">{group.label}</div>{visible.map(([label,href])=><Link href={href} key={`${group.label}-${label}`}>{label}</Link>)}</div>})}</nav><div className="sidebar-user"><strong>{user.name}</strong><span>{user.roles.join(", ")}</span><LogoutButton/></div></aside><main className="main"><FlowReturnBridge/>{children}</main></div>}</body></html>}
