import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { ensureDefaultWarehouse } from "@/lib/accounting/warehouse-stock";

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    await prisma.$transaction(async (tx) => { await ensureDefaultWarehouse(tx); });
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        isDefault: true,
      },
    });
    return NextResponse.json({
      ok: true,
      warehouses: warehouses.map((warehouse) => ({
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        location: warehouse.location || "",
        isDefault: warehouse.isDefault,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Warehouse options failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}
