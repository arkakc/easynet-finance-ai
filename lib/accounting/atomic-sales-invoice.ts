import type { AtomicPostingLine } from "@/lib/accounting/atomic-posting";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { round2, round4 } from "@/lib/accounting/inventory";
import { salesInvoicePostingByLines } from "@/lib/accounting/posting-rules";
import {
  ensurePaymentScheduleInfrastructure,
  findPaymentSchedules,
  insertPaymentSchedule,
} from "@/lib/accounting/payment-schedule-store";
import { prisma } from "@/src/lib/prisma";
import { resolveWarehouse, syncWarehouseBalance, warehouseInventoryState } from "@/lib/accounting/warehouse-stock";

export type AtomicSalesInvoiceRevenueLine = {
  accountId: string;
  amount: number;
  description?: string;
  deferred?: boolean;
};

export type AtomicSalesInvoiceStockLine = {
  itemId: string;
  quantity: number;
  costAccountId: string;
  fallbackRate?: number;
  description?: string;
  warehouseRef?: string;
};

export type AtomicSalesInvoiceInput = {
  invoiceId: string;
  postingDate: string;
  documentNumber: string;
  reference?: string;
  customerId: string;
  projectId?: string;
  sourceDocumentId?: string;
  warehouseRef?: string;
  total: number;
  gst: number;
  revenueLines: AtomicSalesInvoiceRevenueLine[];
  stockLines: AtomicSalesInvoiceStockLine[];
  receivableAccountId: string;
  deferredRevenueAccountId: string;
  inventoryAccountId: string;
  deferredSchedules?: Array<Record<string, unknown>>;
  approveIfDraft?: boolean;
  createdBy?: string;
  approvedBy?: string;
};

export async function finalizeSalesInvoiceAtomic(input: AtomicSalesInvoiceInput) {
  // Infrastructure DDL is outside the business transaction; schedule rows
  // themselves are inserted inside the same Prisma transaction as stock + GL.
  await ensurePaymentScheduleInfrastructure(prisma);

  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const invoice = await tx.invoice.findFirst({
      where: { OR: [{ id: input.invoiceId }, { code: input.invoiceId }] },
    });
    if (!invoice) throw new Error("Sales Invoice not found");

    if (invoice.glPosted && invoice.journalId) {
      return {
        invoiceId: invoice.id,
        journalId: invoice.journalId,
        status: "POSTED" as const,
        stockLines: 0,
        stockSource: "ALREADY_POSTED" as const,
        deferredSchedules: 0,
        alreadyPosted: true,
      };
    }
    if (invoice.status === "DRAFT") {
      if (!input.approveIfDraft) {
        throw new Error("Sales Invoice must be APPROVED before posting. Current status: DRAFT");
      }
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "SENT",
          approvedBy: input.approvedBy || "Finance Controller",
          approvedAt: new Date(),
        },
      });
    } else if (invoice.status !== "SENT") {
      throw new Error(`Sales Invoice must be APPROVED before posting. Current status: ${invoice.status}`);
    }

    const deliveryIssues = input.sourceDocumentId
      ? await tx.stockMovement.findMany({
          where: {
            referenceId: input.sourceDocumentId,
            type: "SALES_DELIVERY",
          },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const stockAlreadyIssuedByDeliveryNote = deliveryIssues.length > 0;

    const cogsLines: Array<{ accountId: string; amount: number; description?: string }> = [];
    const createdMovementIds: string[] = [];

    if (!stockAlreadyIssuedByDeliveryNote && input.stockLines.length) {
      const existingInvoiceIssues = await tx.stockMovement.findMany({
        where: {
          referenceId: invoice.id,
          type: "SALES_ISSUE",
        },
      });
      if (existingInvoiceIssues.length) {
        throw new Error("Existing Sales Invoice stock issue found without a posted invoice journal; manual review required");
      }

      for (const [index, requested] of input.stockLines.entries()) {
        const quantity = Number(requested.quantity || 0);
        if (!(quantity > 0)) throw new Error(`Invalid stock quantity on Sales Invoice stock line ${index + 1}`);

        const item = await tx.item.findFirst({
          where: { OR: [{ id: requested.itemId }, { code: requested.itemId }] },
        });
        if (!item) throw new Error(`Sales Invoice stock item not found: ${requested.itemId}`);

        const warehouse = await resolveWarehouse(
          tx,
          requested.warehouseRef || input.warehouseRef,
        );
        const state = await warehouseInventoryState(
          tx,
          item.id,
          warehouse.id,
          Number(requested.fallbackRate ?? item.purchasePrice ?? item.sellPrice ?? 0),
        );
        if (quantity > state.qty + 0.0001) {
          throw new Error(
            `Insufficient stock for ${item.code} in ${warehouse.code}. On hand ${state.qty}, required ${quantity}`,
          );
        }

        const value = round2(quantity * state.rate);
        const movementId = `SI-STK-${invoice.id}-${String(index + 1).padStart(3, "0")}`;
        await tx.stockMovement.create({
          data: {
            id: movementId,
            itemId: item.id,
            warehouseId: warehouse.id,
            type: "SALES_ISSUE",
            quantity,
            unitCost: state.rate,
            totalCost: value,
            referenceType: "SALES_ISSUE",
            referenceId: invoice.id,
            projectId: input.projectId || null,
            createdAt: new Date(`${String(input.postingDate).slice(0, 10)}T00:00:00+10:00`),
            createdBy: input.createdBy || "sales-invoice-posting",
          },
        });
        createdMovementIds.push(movementId);

        const nextQty = round4(state.qty - quantity);
        const nextValue = round2(state.value - value);
        await syncWarehouseBalance(tx, {
          itemId: item.id,
          warehouseId: warehouse.id,
          quantity: nextQty,
          value: nextValue,
          rate: nextQty > 0 ? round4(nextValue / nextQty) : state.rate,
        });

        cogsLines.push({
          accountId: requested.costAccountId,
          amount: value,
          description: requested.description || "Cost of goods sold",
        });
      }
    }

    const scheduleRows = input.deferredSchedules || [];
    const existingSchedules = scheduleRows.length
      ? await findPaymentSchedules("DEFERRED_REVENUE", invoice.id, tx)
      : [];
    const existingScheduleIds = new Set(existingSchedules.map((row) => row.scheduleId));
    let insertedScheduleCount = 0;
    for (const schedule of scheduleRows) {
      const scheduleId = String(schedule.scheduleId || "").trim();
      if (!scheduleId || existingScheduleIds.has(scheduleId)) continue;
      await insertPaymentSchedule({
        ...schedule,
        sourceType: "DEFERRED_REVENUE",
        sourceId: invoice.id,
      }, input.createdBy || "deferred-revenue-schedule", tx);
      insertedScheduleCount += 1;
    }

    const lines: AtomicPostingLine[] = salesInvoicePostingByLines({
      total: Number(input.total),
      gst: Number(input.gst),
      customerId: input.customerId,
      projectId: input.projectId,
      revenueLines: input.revenueLines,
      cogsLines,
      receivableAccountId: input.receivableAccountId,
      deferredRevenueAccountId: input.deferredRevenueAccountId,
      inventoryAccountId: input.inventoryAccountId,
    });

    // Journal creation occurs after stock and schedule mutations intentionally:
    // a journal validation/persistence failure must prove those writes roll back.
    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: "SALES_INVOICE",
      documentId: invoice.id,
      documentNumber: input.documentNumber,
      reference: input.reference || `Sales invoice ${input.documentNumber}`,
      projectId: input.projectId,
      createdBy: input.createdBy || "sales-invoice-posting",
      approvedBy: input.approvedBy || "Finance Controller",
      lines,
    });

    if (createdMovementIds.length) {
      await tx.stockMovement.updateMany({
        where: { id: { in: createdMovementIds } },
        data: { journalId: journal.journalId },
      });
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "SENT",
        glPosted: true,
        journalId: journal.journalId,
        approvedBy: input.approvedBy || invoice.approvedBy || "Finance Controller",
        approvedAt: invoice.approvedAt || new Date(),
      },
    });

    return {
      invoiceId: invoice.id,
      journalId: journal.journalId,
      status: "POSTED" as const,
      stockLines: stockAlreadyIssuedByDeliveryNote ? deliveryIssues.length : createdMovementIds.length,
      stockSource: stockAlreadyIssuedByDeliveryNote ? "DELIVERY_NOTE" as const : "INVOICE" as const,
      deferredSchedules: existingSchedules.length + insertedScheduleCount,
      alreadyPosted: false,
    };
  });
}
