import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { inventoryIssuePosting, type PostingLine } from "@/lib/accounting/posting-rules";
import { round2, round4 } from "@/lib/accounting/inventory";
import {
  resolveWarehouse,
  syncWarehouseBalance,
  warehouseInventoryState,
} from "@/lib/accounting/warehouse-stock";

export async function postSalesDeliveryAtomic(input: {
  deliveryNumber: string;
  postingDate: string;
  salesOrderRef: string;
  warehouseRef?: string;
  inventoryAccountId: string;
  defaultCostAccountId: string;
  createdBy?: string;
  approvedBy?: string;
}) {
  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const order = await tx.quote.findFirst({
      where: { OR: [{ id: input.salesOrderRef }, { code: input.salesOrderRef }] },
      include: {
        customer: { select: { code: true } },
        project: { select: { code: true } },
        lines: {
          include: { item: true },
          orderBy: { lineNo: "asc" },
        },
      },
    });
    if (!order || !order.code.toUpperCase().startsWith("SO-")) {
      throw new Error("Delivery Note source must be a valid Sales Order");
    }
    if (!["ACCEPTED", "PART_DELIVERED"].includes(order.status)) {
      throw new Error(`Delivery Note can only be created from an approved Sales Order. Current status: ${order.status}`);
    }

    const warehouse = await resolveWarehouse(tx, input.warehouseRef);
    const stockLines = order.lines.filter((line) => line.item?.type === "GOOD");
    if (!stockLines.length) {
      await tx.quote.update({
        where: { id: order.id },
        data: { status: "DELIVERED" },
      });
      return {
        deliveryNumber: input.deliveryNumber,
        salesOrderId: order.id,
        journalId: "",
        movementCount: 0,
        noStock: true,
        status: "DELIVERED" as const,
        warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
      };
    }

    const glLines: PostingLine[] = [];
    const movementIds: string[] = [];
    const valuationUpdates: Array<{
      itemId: string;
      quantity: number;
      value: number;
      rate: number;
    }> = [];

    for (const [index, line] of stockLines.entries()) {
      if (!line.item) continue;
      const ordered = Number(line.quantity || 0);
      const delivered = await tx.stockMovement.aggregate({
        where: {
          itemId: line.item.id,
          type: "SALES_DELIVERY",
          referenceId: order.id,
        },
        _sum: { quantity: true },
      });
      const deliveredBefore = Number(delivered._sum.quantity || 0);
      const remaining = round4(Math.max(0, ordered - deliveredBefore));
      if (remaining <= 0.0001) continue;

      const current = await warehouseInventoryState(
        tx,
        line.item.id,
        warehouse.id,
        Number(line.item.purchasePrice || 0),
      );
      if (remaining > current.qty + 0.0001) {
        throw new Error(
          `Insufficient stock for ${line.item.code} in ${warehouse.code}. On hand ${current.qty}, delivery required ${remaining}`,
        );
      }

      const value = round2(remaining * current.rate);
      glLines.push(...inventoryIssuePosting({
        amount: value,
        costAccountId: String(line.item.costAccount || input.defaultCostAccountId),
        projectId: order.project?.code || order.projectId || undefined,
        description: `Delivery Note COGS: ${line.description || line.item.name || line.item.code}`,
        inventoryAccountId: input.inventoryAccountId,
      }));

      const movementId = `${input.deliveryNumber}-${String(index + 1).padStart(3, "0")}`;
      await tx.stockMovement.create({
        data: {
          id: movementId,
          itemId: line.item.id,
          warehouseId: warehouse.id,
          type: "SALES_DELIVERY",
          quantity: remaining,
          unitCost: current.rate,
          totalCost: value,
          referenceType: "SALES_DELIVERY",
          referenceId: order.id,
          projectId: order.projectId || null,
          createdAt: new Date(`${input.postingDate.slice(0, 10)}T00:00:00+10:00`),
          createdBy: input.createdBy || "sales-delivery-note",
        },
      });
      movementIds.push(movementId);

      const nextQty = round4(current.qty - remaining);
      const nextValue = round2(current.value - value);
      const nextRate = nextQty > 0 ? round4(nextValue / nextQty) : current.rate;
      valuationUpdates.push({
        itemId: line.item.id,
        quantity: nextQty,
        value: nextValue,
        rate: nextRate,
      });
    }

    if (!movementIds.length) {
      throw new Error("All stock lines are already delivered for this Sales Order");
    }

    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: "SALES_DELIVERY_NOTE",
      documentId: input.deliveryNumber,
      documentNumber: input.deliveryNumber,
      reference: `Delivery Note against ${order.code} from ${warehouse.code}`,
      projectId: order.project?.code || order.projectId || undefined,
      createdBy: input.createdBy || "sales-delivery-note",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: glLines,
    });

    await tx.stockMovement.updateMany({
      where: { id: { in: movementIds } },
      data: { journalId: journal.journalId },
    });

    for (const valuation of valuationUpdates) {
      await syncWarehouseBalance(tx, {
        itemId: valuation.itemId,
        warehouseId: warehouse.id,
        quantity: valuation.quantity,
        value: valuation.value,
        rate: valuation.rate,
      });
    }

    let fullyDelivered = true;
    for (const line of stockLines) {
      if (!line.itemId) continue;
      const delivered = await tx.stockMovement.aggregate({
        where: {
          itemId: line.itemId,
          type: "SALES_DELIVERY",
          referenceId: order.id,
        },
        _sum: { quantity: true },
      });
      if (Number(delivered._sum.quantity || 0) + 0.0001 < Number(line.quantity || 0)) {
        fullyDelivered = false;
        break;
      }
    }

    await tx.quote.update({
      where: { id: order.id },
      data: { status: fullyDelivered ? "DELIVERED" : "PART_DELIVERED" },
    });

    return {
      deliveryNumber: input.deliveryNumber,
      salesOrderId: order.id,
      journalId: journal.journalId,
      movementCount: movementIds.length,
      movementIds,
      noStock: false,
      status: fullyDelivered ? "DELIVERED" as const : "PART_DELIVERED" as const,
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
    };
  });
}
