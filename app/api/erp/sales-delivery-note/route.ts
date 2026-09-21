import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { postSalesDeliveryAtomic } from "@/lib/accounting/atomic-sales-delivery";

const schema = z.object({
  salesOrderId: z.string().trim().min(1),
  deliveryDate: z.string().trim().min(8),
  warehouseId: z.string().trim().optional().default(""),
});

function year() {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Pacific/Port_Moresby",
      year: "numeric",
    }).format(new Date()),
  );
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = schema.parse(await request.json());
    await ensureAccountingInfrastructure();
    const defaults = await loadConfiguredPostingAccounts();

    const result = await postSalesDeliveryAtomic({
      deliveryNumber: documentSeriesId("DN", year()),
      postingDate: normalizeAccountingDate(input.deliveryDate),
      salesOrderRef: input.salesOrderId,
      warehouseRef: input.warehouseId || undefined,
      inventoryAccountId: defaults.defaultInventoryAccount,
      defaultCostAccountId: defaults.defaultCostOfGoodsSoldAccount,
      createdBy: "sales-delivery-note",
      approvedBy: "Finance Controller",
    });

    console.info("sales-delivery-note.posted", {
      salesOrderId: result.salesOrderId,
      deliveryNumber: result.deliveryNumber,
      journalId: result.journalId || null,
      movementCount: result.movementCount,
      warehouse: result.warehouse.code,
      status: result.status,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: result.noStock
        ? "Sales Order has no stock lines; delivery control marked as complete."
        : undefined,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error
        ? error.message
        : "Delivery Note failed";
    console.error("sales-delivery-note.failed", { message });
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 },
    );
  }
}
