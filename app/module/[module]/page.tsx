import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { groups } from "@/lib/navigation/sidebar-groups";
import { getSetupGateState } from "@/lib/setup-gate";
export const dynamic="force-dynamic";
function slug(label:string){return label.toLowerCase().replace(/[^a-z0-9]+/g,"-");}
export default async function ModuleMenuPage({params}:{params:Promise<{module:string}>}){
 const {module}=await params;
 const user=await getCurrentUser();
 if(!user)redirect("/login");
 const group=groups.find(item=>slug(item.label)===module && item.label!=="Home");
 if(!group)notFound();
 const { openingSubledgerLocked }=await getSetupGateState();
 const links=group.links.filter(([, ,permission])=>hasPermission(user,permission));
 if(!links.length)notFound();
 return <div className="ef-module-directory">
  <header className="ef-module-directory-header"><span className="ef-module-directory-kicker"><LayoutGrid size={17}/> EASYNET FINANCE / MODULES</span><h1>{group.label}</h1><p>Select the workspace or function you want to open. All your permitted options are available here, without expanding the left navigation.</p></header>
  <section className="ef-module-directory-panel"><h2>{group.label} menu</h2><div className="ef-module-directory-grid">{links.map(([label,href])=>href==="/migration/opening-subledger"&&openingSubledgerLocked?<div key={href} className="ef-module-directory-tile ef-module-disabled" aria-disabled="true" title="Opening AR/AP import is locked for this company"><span><strong>{label}</strong><small>Unavailable in current company setup</small></span></div>:<Link key={href+label} href={href} className="ef-module-directory-tile"><span><strong>{label}</strong><small>Open {label.toLowerCase()}</small></span><ArrowUpRight size={18}/></Link>)}</div></section>
 </div>;
}
