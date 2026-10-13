import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BarChart3, BookOpen, FolderKanban, Home, Landmark, Package, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, UserRound } from "lucide-react";
import { getCurrentUser, hasPermission, type Permission } from "@/lib/auth";

export const dynamic = "force-dynamic";

const modules: { name:string; description:string; href:string; permission:Permission; icon: typeof Home }[] = [
 {name:"Sales",description:"Customers, quotations and invoices",href:"/workspace/sales",permission:"sales.read",icon:ShoppingCart},
 {name:"Purchases",description:"Suppliers, orders and bills",href:"/workspace/purchases",permission:"purchase.read",icon:ShoppingBag},
 {name:"Inventory",description:"Items, warehouses and stock",href:"/workspace/inventory",permission:"stock.read",icon:Package},
 {name:"Accounting",description:"Journals, chart of accounts and banking",href:"/workspace/accounting",permission:"accounts.read",icon:Landmark},
 {name:"Reports",description:"Financial and management reporting",href:"/workspace/reports",permission:"reports.read",icon:BarChart3},
 {name:"Projects",description:"Project costs and profitability",href:"/workspace/projects",permission:"dashboard.read",icon:FolderKanban},
];

export default async function HomePage() {
 const user=await getCurrentUser();
 if(!user)redirect("/login");
 const firstName=user.name.trim().split(/\s+/)[0] || "there";
 const visible=modules.filter(module=>hasPermission(user,module.permission));
 return <div className="ef-home">
  <header className="ef-home-hero">
   <div className="ef-home-hero-copy">
    <div className="ef-home-kicker"><Home size={16}/> HOME · EASYNET FINANCE</div>
    <h1>Welcome back, {firstName}.</h1>
    <p>Your Easynet Finance AI workspace. Manage everyday operations, financial records and reporting from one connected Mini ERP.</p>
    <div className="ef-home-hero-actions">
     {hasPermission(user,"dashboard.read")&&<Link href="/dashboard" className="ef-home-primary">Open dashboard <ArrowUpRight size={16}/></Link>}
     {hasPermission(user,"reports.read")&&<Link href="/reports" className="ef-home-secondary">View reports <ArrowUpRight size={15}/></Link>}
    </div>
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
   <div className="ef-home-modules">{visible.map(module=>{const Icon=module.icon;return <Link key={module.href} className="ef-home-module" href={module.href}><span className="ef-home-module-icon"><Icon size={21}/></span><span className="ef-home-module-copy"><strong>{module.name}</strong><small>{module.description}</small></span><ArrowUpRight size={17} className="ef-home-module-arrow"/></Link>})}</div>
  </section>

  <section className="ef-home-note"><BookOpen size={20}/><div><strong>Designed for day-to-day finance operations</strong><p>The Home page is your starting point. Use the Dashboard for live financial insights and the module menu for transactions. Figures and balances are intentionally not duplicated here.</p></div></section>
  <footer className="ef-home-footer">Easynet Finance AI System · Powered by Easynet IT Solutions · Papua New Guinea</footer>
 </div>;
}
