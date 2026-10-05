import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

type Scope = "customer" | "supplier" | "project" | "sales" | "purchase";

const VALID_SCOPES = new Set<Scope>(["customer", "supplier", "project", "sales", "purchase"]);

export const dynamic = "force-dynamic";

async function lifecycleMaps(){
  const [customers,suppliers,projects]=await Promise.all([
    prisma.customer.findMany({
      select:{
        id:true,code:true,isActive:true,
        _count:{select:{quotes:true,invoices:true,payments:true,creditNotes:true,projects:true}},
      },
    }),
    prisma.supplier.findMany({
      select:{
        id:true,code:true,isActive:true,
        _count:{select:{purchaseOrders:true,bills:true,payments:true,expenses:true,fixedAssets:true,projects:true}},
      },
    }),
    prisma.project.findMany({
      select:{
        id:true,code:true,status:true,
        _count:{select:{quotes:true,invoices:true,purchaseOrders:true,bills:true,payments:true,creditNotes:true,refunds:true,expenses:true,timeEntries:true,budgets:true}},
      },
    }),
  ]);
  const customerMap=new Map(customers.flatMap(row=>[
    [row.id,{active:row.isActive,usageCount:Object.values(row._count).reduce((sum,value)=>sum+Number(value||0),0)}] as const,
    [row.code,{active:row.isActive,usageCount:Object.values(row._count).reduce((sum,value)=>sum+Number(value||0),0)}] as const,
  ]));
  const supplierMap=new Map(suppliers.flatMap(row=>[
    [row.id,{active:row.isActive,usageCount:Object.values(row._count).reduce((sum,value)=>sum+Number(value||0),0)}] as const,
    [row.code,{active:row.isActive,usageCount:Object.values(row._count).reduce((sum,value)=>sum+Number(value||0),0)}] as const,
  ]));
  const projectMap=new Map(projects.flatMap(row=>[
    [row.id,{status:String(row.status||"ACTIVE"),usageCount:Object.values(row._count).reduce((sum,value)=>sum+Number(value||0),0)}] as const,
    [row.code,{status:String(row.status||"ACTIVE"),usageCount:Object.values(row._count).reduce((sum,value)=>sum+Number(value||0),0)}] as const,
  ]));
  return {customerMap,supplierMap,projectMap};
}

function enrichRows(rows:any[],map:Map<string,any>,idKeys:string[]){
  return rows.map(row=>{
    const key=idKeys.map(idKey=>String(row?.[idKey]||"").trim()).find(Boolean)||"";
    const lifecycle=map.get(key);
    return lifecycle?{...row,...lifecycle}:row;
  });
}


export async function GET(request: NextRequest) {
  try {
    await requirePermission("dashboard.read");
    let rawScope = request.headers.get("x-erp-scope")
      || request.nextUrl.searchParams.get("scope")
      || "";
    if (!rawScope) {
      try {
        rawScope = new URL(request.url).searchParams.get("scope") || "";
      } catch {}
    }
    if (!rawScope) {
      const referer = request.headers.get("referer") || "";
      rawScope = referer.includes("module=purchase") ? "purchase" : "sales";
    }
    const scope = (rawScope || "sales") as Scope;
    if (!VALID_SCOPES.has(scope)) {
      return NextResponse.json({ ok: false, error: "Invalid master-data scope" }, { status: 400 });
    }

    if (scope === "customer") {
      const [customers,maps] = await Promise.all([listTable("Customers", 500, 0),lifecycleMaps()]);
      return NextResponse.json({ ok: true, scope, customers: enrichRows(customers.rows,maps.customerMap,["customerId","internalCustomerId","customerCode","id","code"]) });
    }

    if (scope === "supplier") {
      const [suppliers,maps] = await Promise.all([listTable("Suppliers", 500, 0),lifecycleMaps()]);
      return NextResponse.json({ ok: true, scope, suppliers: enrichRows(suppliers.rows,maps.supplierMap,["supplierId","internalSupplierId","supplierCode","id","code"]) });
    }

    if (scope === "project") {
      const [projects, customers, maps] = await Promise.all([
        listTable("Projects", 500, 0),
        listTable("Customers", 500, 0),
        lifecycleMaps(),
      ]);
      return NextResponse.json({
        ok:true,
        scope,
        projects:enrichRows(projects.rows,maps.projectMap,["projectId","internalProjectId","projectCode","id","code"]),
        customers:enrichRows(customers.rows,maps.customerMap,["customerId","internalCustomerId","customerCode","id","code"]),
      });
    }

    if (scope === "sales") {
      const [customers, projects, maps] = await Promise.all([
        listTable("Customers", 500, 0),
        listTable("Projects", 500, 0),
        lifecycleMaps(),
      ]);
      const enrichedCustomers=enrichRows(customers.rows,maps.customerMap,["customerId","internalCustomerId","customerCode","id","code"]);
      const enrichedProjects=enrichRows(projects.rows,maps.projectMap,["projectId","internalProjectId","projectCode","id","code"]);
      const activeProjects = enrichedProjects.filter((row: any) => ["ACTIVE","PLANNING","OPEN"].includes(String(row.status || "ACTIVE").toUpperCase().replace(/\s+/g,"_")));
      return NextResponse.json({ ok: true, scope, customers: enrichedCustomers.filter((row:any)=>row.active!==false), projects: activeProjects });
    }

    const [suppliers, projects, maps] = await Promise.all([
      listTable("Suppliers", 500, 0),
      listTable("Projects", 500, 0),
      lifecycleMaps(),
    ]);
    const enrichedSuppliers=enrichRows(suppliers.rows,maps.supplierMap,["supplierId","internalSupplierId","supplierCode","id","code"]);
    const enrichedProjects=enrichRows(projects.rows,maps.projectMap,["projectId","internalProjectId","projectCode","id","code"]);
    const activeProjects = enrichedProjects.filter((row: any) => ["ACTIVE","PLANNING","OPEN"].includes(String(row.status || "ACTIVE").toUpperCase().replace(/\s+/g,"_")));
    return NextResponse.json({ ok: true, scope, suppliers: enrichedSuppliers.filter((row:any)=>row.active!==false), projects: activeProjects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Master-data read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}
