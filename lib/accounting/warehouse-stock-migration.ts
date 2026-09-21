import { prisma } from "@/src/lib/prisma";
import { ensureDefaultWarehouse, recomputeWarehouseBalance } from "@/lib/accounting/warehouse-stock";

export async function backfillWarehouseStock(options: { apply?: boolean } = {}) {
  const apply = options.apply === true;

  const [unassignedMovements, warehouseCount, balanceCount] = await Promise.all([
    prisma.stockMovement.count({ where: { warehouseId: null } }),
    prisma.warehouse.count(),
    prisma.warehouseStockBalance.count(),
  ]);

  if (!apply) {
    const defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true, code: true, name: true },
    });
    return {
      mode: "PREVIEW" as const,
      warehouseCount,
      existingWarehouseBalanceRows: balanceCount,
      unassignedMovements,
      defaultWarehouse: defaultWarehouse || null,
      action: "Create/resolve MAIN warehouse, assign legacy movements to it, rebuild item-by-warehouse balances",
    };
  }

  return prisma.$transaction(async (tx) => {
    const warehouse = await ensureDefaultWarehouse(tx);

    const assigned = await tx.stockMovement.updateMany({
      where: { warehouseId: null },
      data: { warehouseId: warehouse.id },
    });

    const pairs = await tx.stockMovement.findMany({
      where: { warehouseId: { not: null } },
      distinct: ["itemId", "warehouseId"],
      select: { itemId: true, warehouseId: true },
    });

    let rebuilt = 0;
    for (const pair of pairs) {
      if (!pair.warehouseId) continue;
      const item = await tx.item.findUnique({
        where: { id: pair.itemId },
        select: { purchasePrice: true },
      });
      await recomputeWarehouseBalance(tx, {
        itemId: pair.itemId,
        warehouseId: pair.warehouseId,
        fallbackRate: Number(item?.purchasePrice || 0),
      });
      rebuilt += 1;
    }

    return {
      mode: "LIVE" as const,
      defaultWarehouse: {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
      },
      legacyMovementsAssigned: assigned.count,
      warehouseBalanceRowsRebuilt: rebuilt,
    };
  });
}
