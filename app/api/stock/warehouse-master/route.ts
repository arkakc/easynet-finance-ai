import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const schema = z.object({
  action: z.enum(["edit", "delete", "disable", "activate", "bulkDelete", "bulkDisable", "bulkActivate"]),
  ids: z.array(z.string().min(1)).optional(),
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  location: z.string().trim().max(240).optional(),
});
const stockPresent = (row: { quantity: unknown; reserved: unknown; available: unknown; stockValue: unknown }) =>
  Math.abs(Number(row.quantity || 0)) > 0.0001 || Math.abs(Number(row.reserved || 0)) > 0.0001 ||
  Math.abs(Number(row.available || 0)) > 0.0001 || Math.abs(Number(row.stockValue || 0)) > 0.005;

export async function GET() {
  try {
    await requirePermission("stock.read");
    const rows = await prisma.warehouse.findMany({ orderBy: { code: "asc" }, include: { balances: true, _count: { select: { movements: true } } } });
    return NextResponse.json({ ok: true, warehouses: rows.map(w => ({
      warehouseId: w.id, warehouseCode: w.code, warehouseName: w.name, location: w.location || "",
      isDefault: w.isDefault, active: w.isActive, historyCount: w._count.movements,
      hasStock: w.balances.some(stockPresent), canDelete: !w.isDefault && !w._count.movements && !w.balances.some(stockPresent),
    })) });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Warehouse list failed" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    await requirePermission("stock.write");
    const input = schema.parse(await request.json());
    const ids = [...new Set(input.ids || (input.id ? [input.id] : []))];
    if (!ids.length) throw new Error("Select at least one warehouse");
    const results = await prisma.$transaction(async tx => {
      const outcome: Array<{ id: string; status: string; reason?: string }> = [];
      for (const id of ids) {
        const w = await tx.warehouse.findUnique({ where: { id }, include: { balances: true, _count: { select: { movements: true } } } });
        if (!w) { outcome.push({ id, status: "skipped", reason: "Warehouse not found" }); continue; }
        const hasStock = w.balances.some(stockPresent);
        const used = w._count.movements > 0;
        const action = input.action.replace(/^bulk/, "").toLowerCase();
        if (action === "edit") {
          if (ids.length !== 1 || !input.name) throw new Error("Warehouse name is required");
          await tx.warehouse.update({ where: { id }, data: { name: input.name, location: input.location ?? w.location } });
        } else if (action === "delete") {
          if (w.isDefault || used || hasStock) { outcome.push({ id, status: "skipped", reason: w.isDefault ? "Reassign default warehouse first" : used ? "Transaction history exists" : "Stock balance or valuation exists" }); continue; }
          await tx.warehouseStockBalance.deleteMany({ where: { warehouseId: id } });
          await tx.warehouse.delete({ where: { id } });
        } else if (action === "disable") {
          if (w.isDefault || hasStock) { outcome.push({ id, status: "skipped", reason: w.isDefault ? "Reassign default warehouse first" : "Transfer all stock and clear reservations/value first" }); continue; }
          if (!w.isActive) { outcome.push({ id, status: "skipped", reason: "Already inactive" }); continue; }
          await tx.warehouse.update({ where: { id }, data: { isActive: false } });
        } else if (action === "activate") {
          if (w.isActive) { outcome.push({ id, status: "skipped", reason: "Already active" }); continue; }
          await tx.warehouse.update({ where: { id }, data: { isActive: true } });
        }
        outcome.push({ id, status: "success" });
      }
      return outcome;
    });
    return NextResponse.json({ ok: true, results });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Warehouse action failed" }, { status: 400 }); }
}
