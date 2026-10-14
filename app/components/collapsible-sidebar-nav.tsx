"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, LayoutDashboard, ShoppingCart, ShoppingBag, Package, Landmark, FolderKanban, BarChart3, Sparkles, Settings, Wrench, ChevronRight } from "lucide-react";

export type SidebarNavGroup = {
 label:string; icon:string;
 links:{label:string;href:string;disabled?:boolean;disabledReason?:string}[];
};
type Props={groups:SidebarNavGroup[];compact?:boolean;onNavigate?:(href:string)=>void};
const icons:Record<string,typeof Home>={Home,Dashboard:LayoutDashboard,Sales:ShoppingCart,Purchase:ShoppingBag,"Stock & Assets":Package,Accounts:Landmark,Projects:FolderKanban,Reports:BarChart3,"Documents & AI":Sparkles,Administration:Settings,"System Setup":Wrench};
function selected(href:string,pathname:string,query:URLSearchParams){
 const [path,search]=href.split("?");
 if(path!==pathname)return false;
 if(!search)return true;
 return [...new URLSearchParams(search)].every(([key,value])=>query.get(key)===value);
}
export default function CollapsibleSidebarNav({groups,onNavigate}:Props){
 const pathname=usePathname(),query=useSearchParams();
 return <nav aria-label="Main modules">
  {groups.map(group=>{
   const Icon=icons[group.label]||Package;
   const active=pathname==="/module/"+encodeURIComponent(group.label.toLowerCase().replace(/[^a-z0-9]+/g,"-"))||group.links.some(link=>selected(link.href,pathname,query));
   const href=group.label==="Home"?"/home":"/module/"+encodeURIComponent(group.label.toLowerCase().replace(/[^a-z0-9]+/g,"-"));
   return <Link key={group.label} href={href} prefetch={false} onClick={event=>{if(!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)onNavigate?.(href);}} title={group.label} className={`nav-label ef-main-menu-link ${active?"ef-main-menu-active":""}`} aria-current={active?"page":undefined}>
    <span className="nav-label-main"><span className="nav-section-icon"><Icon size={19} strokeWidth={2} aria-hidden="true"/></span><span className="nav-label-text">{group.label}</span></span>
    {group.label!=="Home"&&<ChevronRight size={15} aria-hidden="true"/>}
   </Link>;
  })}
 </nav>;
}
