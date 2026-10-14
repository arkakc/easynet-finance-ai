import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BarChart3, BookOpen, FolderKanban, Home, Landmark, Package, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, UserRound, LayoutDashboard, Settings } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { groups } from "@/lib/navigation/sidebar-groups";

export const dynamic = "force-dynamic";

const descriptions:Record<string,string>={
 Dashboard:"Management dashboards, controls and approvals",
 Sales:"Customers, quotations and invoices",
 Purchase:"Suppliers, purchase orders and bills",
 "Stock & Assets":"Inventory, warehouses and fixed assets",
 Accounts:"General ledger, journals, banking and payroll",
 Projects:"Project costs and profitability",
 Reports:"Financial statements, GST and management reports",
 "Documents & AI":"Source documents and AI-assisted document processing",
 Administration:"Settings, users, permissions and system recovery",
};
const moduleIcons:Record<string,typeof Home>={
 Dashboard:LayoutDashboard,Sales:ShoppingCart,Purchase:ShoppingBag,
 "Stock & Assets":Package,Accounts:Landmark,Projects:FolderKanban,
 Reports:BarChart3,"Documents & AI":Sparkles,Administration:Settings,
};
const moduleSlug=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-");

export default async function HomePage() {
 const user=await getCurrentUser();
 if(!user)redirect("/login");
 const firstName=user.name.trim().split(/\s+/)[0] || "there";
 const visible=groups.filter(group=>group.label!=="Home" && group.links.some(([, ,permission])=>hasPermission(user,permission)));
 return <div className="ef-home">
  <header className="ef-home-hero">
   <div className="ef-home-hero-copy">
    <div className="ef-home-kicker"><Home size={16}/> HOME · EASYNET FINANCE</div>
    <h1>Welcome back, {firstName}.</h1>
    <p>Your Easynet Finance AI workspace. Manage everyday operations, financial records and reporting from one connected Mini ERP.</p>
   </div>
   <div className="ef-home-hero-mark" aria-hidden="true"><Sparkles size={46}/><span>FINANCE</span><strong>MINI ERP</strong></div>
  </header>

  <section className="ef-home-section" aria-labelledby="your-session">
   <div className="ef-home-section-header"><div><span className="ef-home-overline">YOUR WORKSPACE</span><h2 id="your-session">Signed-in account</h2></div><span className="ef-home-session-pill"><ShieldCheck size={14}/> Authenticated session</span></div>
   <div className="ef-home-account-card">
    <div className="ef-home-avatar"><UserRound size={24}/></div>
    <div className="ef-home-account-info"><strong>{user.name}</strong><span>{user.email}</span></div>
    <div className="ef-home-account-roles"><span>Assigned role{user.roles.length!==1?"s":""}</span><strong>{user.roles.join(", ") || "No assigned role"}</strong></div>
   </div>
  </section>

  <section className="ef-home-section" aria-labelledby="quick-access">
   <div className="ef-home-section-header"><div><span className="ef-home-overline">QUICK ACCESS</span><h2 id="quick-access">Explore your modules</h2><p>Only workspaces available to your assigned role are shown.</p></div></div>
   <div className="ef-home-modules">{visible.map(module=>{const Icon=moduleIcons[module.label]||Package;const href="/module/"+moduleSlug(module.label);return <Link key={module.label} className="ef-home-module" href={href}><span className="ef-home-module-icon"><Icon size={21}/></span><span className="ef-home-module-copy"><strong>{module.label}</strong><small>{descriptions[module.label]||"Open module menu"}</small></span><ArrowUpRight size={17} className="ef-home-module-arrow"/></Link>})}</div>
  </section>

  <section className="ef-home-note"><BookOpen size={20}/><div><strong>Designed for day-to-day finance operations</strong><p>The Home page is your starting point. Use the Dashboard for live financial insights and the module menu for transactions. Figures and balances are intentionally not duplicated here.</p></div></section>
  <footer className="ef-home-footer">Easynet Finance AI System · Powered by Easynet IT Solutions · Papua New Guinea</footer>
 </div>;
}
