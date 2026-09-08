import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";

type Scope = "customer" | "supplier" | "project" | "sales" | "purchase";

const VALID_SCOPES = new Set<Scope>(["customer", "supplier", "project", "sales", "purchase"]);

export async function GET(request: NextRequest) {
  try {
    await requirePermission("dashboard.read");
    const scope = String(request.nextUrl.searchParams.get("scope") || "") as Scope;
    if (!VALID_SCOPES.has(scope)) {
      return NextResponse.json({ ok: false, error: "Invalid master-data scope" }, { status: 400 });
    }

    if (scope === "customer") {
      const customers = await listTable("Customers", 500, 0);
      return NextResponse.json({ ok: true, scope, customers: customers.rows });
    }

    if (scope === "supplier") {
      const suppliers = await listTable("Suppliers", 500, 0);
      return NextResponse.json({ ok: true, scope, suppliers: suppliers.rows });
    }

    if (scope === "project") {
      const [projects, customers] = await Promise.all([
        listTable("Projects", 500, 0),
        listTable("Customers", 500, 0),
      ]);
      return NextResponse.json({ ok: true, scope, projects: projects.rows, customers: customers.rows });
    }

    if (scope === "sales") {
      const [customers, projects] = await Promise.all([
        listTable("Customers", 500, 0),
        listTable("Projects", 500, 0),
      ]);
      return NextResponse.json({ ok: true, scope, customers: customers.rows, projects: projects.rows });
    }

    const [suppliers, projects] = await Promise.all([
      listTable("Suppliers", 500, 0),
      listTable("Projects", 500, 0),
    ]);
    return NextResponse.json({ ok: true, scope, suppliers: suppliers.rows, projects: projects.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Master-data read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}
