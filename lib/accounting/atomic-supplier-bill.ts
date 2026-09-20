import { ItemType, Prisma } from "@prisma/client";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import {
  supplierBillPostingByLines,
  supplierBillPostingMixed,
} from "@/lib/accounting/posting-rules";
import { round2 } from "@/lib/accounting/inventory";

export type AtomicSupplierBillInput = {
  billId: string;
  purchaseOrderRef?: string;
  postingDate: string;
  documentNumber: string;
  reference?: string;
  payableAccountId: string;
  stockReceivedButNotBilledAccountId: string;
  defaultCostAccountId: string;
  purchasePriceVarianceAccountId?: string;
  purchasePriceVarianceTolerancePct: number;
  approveIfDraft?: boolean;
  createdBy?: string;
  approvedBy?: string;
};

const isStockItem = (type: ItemType) => type === ItemType.GOOD;

const weightedRate = (rows: Array<{ quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }>) => {
  const qty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  if (!(qty > 0)) return 0;
  const value = rows.reduce(
    (sum, row) => sum + Number(row.quantity || 0) * Number(row.unitPrice || 0),
    0,
  );
  return value / qty;
};

export async function finalizeSupplierBillAtomic(input: AtomicSupplierBillInput) {
  const tolerance = Number(input.purchasePriceVarianceTolerancePct || 0);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("Purchase price variance tolerance must be zero or greater");
  }

  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const bill = await tx.supplierBill.findFirst({
      where: { OR: [{ id: input.billId }, { code: input.billId }] },
      include: {
        supplier: { select: { code: true } },
        project: { select: { code: true } },
        lines: { include: { item: true }, orderBy: { lineNo: "asc" } },
      },
    });
    if (!bill) throw new Error("Supplier Invoice not found");

    if (bill.glPosted && bill.journalId) {
      return {
        billId: bill.id,
        journalId: bill.journalId,
        status: "POSTED" as const,
        purchasePriceVariance: 0,
        grniCleared: 0,
        purchaseOrderStatus: null as string | null,
        alreadyPosted: true,
      };
    }
    if (bill.status === "DRAFT") {
      if (!input.approveIfDraft) {
        throw new Error("Supplier Invoice must be APPROVED before posting. Current status: DRAFT");
      }
      await tx.supplierBill.update({
        where: { id: bill.id },
        data: {
          status: "SENT",
          approvedBy: input.approvedBy || "Finance Controller",
          approvedAt: new Date(),
        },
      });
    } else if (bill.status !== "SENT") {
      throw new Error(`Supplier Invoice must be APPROVED before posting. Current status: ${bill.status}`);
    }
    if (!bill.lines.length) throw new Error("Supplier bill has no lines");

    const supplierRef = bill.supplier.code || bill.supplierId;
    const projectRef = bill.project?.code || bill.projectId || "";
    const poRef = String(
      input.purchaseOrderRef
      || bill.orderId
      || bill.sourceDocId
      || bill.poReference
      || "",
    ).trim();

    if (!poRef) {
      const stockLine = bill.lines.find((line) => line.item && isStockItem(line.item.type));
      if (stockLine) {
        throw new Error("Stock Supplier Invoices require an approved Purchase Order and Purchase Receipt");
      }

      const costLines = bill.lines.map((line) => ({
        accountId: String(
          line.costAccount
          || line.item?.costAccount
          || input.defaultCostAccountId,
        ),
        amount: Number(line.amount || 0),
        description: line.description || "Supplier cost",
      }));

      // Change the document state before journal persistence intentionally.
      // A journal failure must roll this change back in the same transaction.
      await tx.supplierBill.update({
        where: { id: bill.id },
        data: {
          status: "SENT",
          glPosted: true,
          approvedBy: input.approvedBy || bill.approvedBy || "Finance Controller",
          approvedAt: bill.approvedAt || new Date(),
        },
      });

      const journal = await postJournal({
        postingDate: input.postingDate,
        documentType: "SUPPLIER_BILL",
        documentId: bill.id,
        documentNumber: input.documentNumber,
        reference: input.reference || `Supplier bill ${input.documentNumber}`,
        projectId: projectRef,
        createdBy: input.createdBy || "supplier-bill-posting",
        approvedBy: input.approvedBy || "Finance Controller",
        lines: supplierBillPostingByLines({
          total: Number(bill.total),
          gst: Number(bill.taxTotal),
          supplierId: supplierRef,
          projectId: projectRef,
          payableAccountId: input.payableAccountId,
          costLines,
        }),
      });

      await tx.supplierBill.update({
        where: { id: bill.id },
        data: { journalId: journal.journalId },
      });

      return {
        billId: bill.id,
        journalId: journal.journalId,
        status: "POSTED" as const,
        purchasePriceVariance: 0,
        grniCleared: 0,
        purchaseOrderStatus: null as string | null,
        alreadyPosted: false,
      };
    }

    const purchaseOrder = await tx.purchaseOrder.findFirst({
      where: {
        OR: [
          { id: poRef },
          { code: poRef },
        ],
      },
      include: {
        lines: { orderBy: { lineNo: "asc" } },
      },
    });
    if (!purchaseOrder) throw new Error("Referenced Purchase Order not found");
    if (purchaseOrder.supplierId !== bill.supplierId) {
      throw new Error("Supplier Invoice supplier does not match the Purchase Order");
    }
    if ((purchaseOrder.projectId || "") !== (bill.projectId || "")) {
      throw new Error("Supplier Invoice project does not match the Purchase Order");
    }

    const priorBills = await tx.supplierBill.findMany({
      where: {
        id: { not: bill.id },
        status: { notIn: ["CANCELLED", "VOID"] },
        OR: [
          { orderId: purchaseOrder.id },
          { sourceDocId: purchaseOrder.id },
          { sourceDocId: purchaseOrder.code },
          { poReference: purchaseOrder.id },
          { poReference: purchaseOrder.code },
        ],
      },
      select: { id: true },
    });
    const priorBillIds = priorBills.map((row) => row.id);
    const priorLines = priorBillIds.length
      ? await tx.billLine.findMany({
          where: { billId: { in: priorBillIds } },
          select: { billId: true, itemId: true, quantity: true },
        })
      : [];

    const previouslyBilledByItem = new Map<string, number>();
    for (const line of priorLines) {
      const itemId = String(line.itemId || "");
      if (!itemId) continue;
      previouslyBilledByItem.set(
        itemId,
        (previouslyBilledByItem.get(itemId) || 0) + Number(line.quantity || 0),
      );
    }

    const receipts = await tx.stockMovement.findMany({
      where: {
        type: "PURCHASE_RECEIPT",
        referenceId: { in: [purchaseOrder.id, purchaseOrder.code] },
      },
      select: {
        itemId: true,
        quantity: true,
        unitCost: true,
        totalCost: true,
      },
    });

    const poLinesByItem = new Map<string, typeof purchaseOrder.lines>();
    for (const poLine of purchaseOrder.lines) {
      const itemId = String(poLine.itemId || "");
      if (!itemId) continue;
      const rows = poLinesByItem.get(itemId) || [];
      rows.push(poLine);
      poLinesByItem.set(itemId, rows);
    }

    const serviceCostLines: Array<{ accountId: string; amount: number; description?: string }> = [];
    const stockLines: Array<{ invoiceAmount: number; receiptValue: number; description?: string }> = [];
    const currentBillQty = new Map<string, number>();

    for (const line of bill.lines) {
      const itemId = String(line.itemId || "");
      if (!itemId || !line.item) {
        throw new Error(`Supplier Invoice item not found in Item Master: ${itemId || "(blank)"}`);
      }

      const matchingPoLines = poLinesByItem.get(itemId) || [];
      if (!matchingPoLines.length) {
        throw new Error(`Supplier Invoice item is not on the Purchase Order: ${line.item.code}`);
      }

      const orderedQty = matchingPoLines.reduce(
        (sum, poLine) => sum + Number(poLine.quantity || 0),
        0,
      );
      const poRate = weightedRate(matchingPoLines);
      const priorBilled = Number(previouslyBilledByItem.get(itemId) || 0);
      const currentQty = Number(line.quantity || 0);
      const currentRate = Number(line.unitPrice || 0);
      const rateVariancePct = poRate > 0
        ? Math.abs(currentRate - poRate) / poRate * 100
        : 0;

      if (rateVariancePct > tolerance + 0.0001) {
        throw new Error(
          `Purchase price variance exceeds ${tolerance}% tolerance for ${line.item.code}. `
          + `PO rate ${poRate.toFixed(2)}, invoice rate ${currentRate.toFixed(2)}`,
        );
      }

      currentBillQty.set(
        itemId,
        (currentBillQty.get(itemId) || 0) + currentQty,
      );

      if (isStockItem(line.item.type)) {
        const itemReceipts = receipts.filter((movement) => movement.itemId === itemId);
        const receivedQty = itemReceipts.reduce(
          (sum, movement) => sum + Number(movement.quantity || 0),
          0,
        );
        const availableToBill = Math.max(0, receivedQty - priorBilled);
        if (currentQty > availableToBill + 0.0001) {
          throw new Error(
            `Three-way match failed for ${line.item.code}: ordered ${orderedQty}, `
            + `received ${receivedQty}, previously billed ${priorBilled}, invoice qty ${currentQty}`,
          );
        }

        const receiptValue = itemReceipts.reduce(
          (sum, movement) => sum + Number(
            movement.totalCost
            ?? (Number(movement.quantity || 0) * Number(movement.unitCost || 0)),
          ),
          0,
        );
        const receiptRate = receivedQty > 0 ? receiptValue / receivedQty : 0;

        stockLines.push({
          invoiceAmount: Number(line.amount || 0),
          receiptValue: round2(currentQty * receiptRate),
          description: line.description || line.item.name || line.item.code,
        });
      } else {
        const availableToBill = Math.max(0, orderedQty - priorBilled);
        if (currentQty > availableToBill + 0.0001) {
          throw new Error(
            `Supplier Invoice quantity exceeds remaining PO quantity for ${line.item.code}`,
          );
        }

        serviceCostLines.push({
          accountId: String(
            line.costAccount
            || line.item.costAccount
            || input.defaultCostAccountId,
          ),
          amount: Number(line.amount || 0),
          description: line.description || line.item.name || line.item.code,
        });
      }
    }

    const mixed = supplierBillPostingMixed({
      total: Number(bill.total),
      gst: Number(bill.taxTotal),
      supplierId: supplierRef,
      projectId: projectRef,
      serviceCostLines,
      stockLines,
      payableAccountId: input.payableAccountId,
      stockReceivedButNotBilledAccountId: input.stockReceivedButNotBilledAccountId,
      purchasePriceVarianceAccountId: input.purchasePriceVarianceAccountId,
    });

    const fullyBilled = [...poLinesByItem.entries()].every(([itemId, poLines]) => {
      const totalOrdered = poLines.reduce(
        (sum, poLine) => sum + Number(poLine.quantity || 0),
        0,
      );
      return (
        Number(previouslyBilledByItem.get(itemId) || 0)
        + Number(currentBillQty.get(itemId) || 0)
        + 0.0001
        >= totalOrdered
      );
    });

    // Mutate AP subledger and PO state before GL creation so journal failure
    // proves that both are protected by the same database transaction.
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: {
        status: "SENT",
        glPosted: true,
        approvedBy: input.approvedBy || bill.approvedBy || "Finance Controller",
        approvedAt: bill.approvedAt || new Date(),
      },
    });

    if (fullyBilled) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          status: "BILLED",
          billId: bill.id,
          convertedAt: new Date(),
        },
      });
    }

    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: "SUPPLIER_BILL",
      documentId: bill.id,
      documentNumber: input.documentNumber,
      reference: input.reference || `Supplier bill ${input.documentNumber}`,
      projectId: projectRef,
      createdBy: input.createdBy || "supplier-bill-posting",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: mixed.lines,
    });

    await tx.supplierBill.update({
      where: { id: bill.id },
      data: { journalId: journal.journalId },
    });

    return {
      billId: bill.id,
      journalId: journal.journalId,
      status: "POSTED" as const,
      purchasePriceVariance: mixed.purchasePriceVariance,
      grniCleared: mixed.receiptValue,
      purchaseOrderStatus: fullyBilled ? "BILLED" : purchaseOrder.status,
      alreadyPosted: false,
    };
  });
}
