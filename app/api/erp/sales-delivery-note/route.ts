import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { postSalesDeliveryAtomic } from "@/lib/accounting/atomic-sales-delivery";
import { prisma } from "@/src/lib/prisma";

const createSchema = z.object({
  action: z.literal("createDraft"),
  salesOrderId: z.string().trim().min(1),
  deliveryDate: z.string().trim().min(8),
});

const approveSchema = z.object({
  action: z.literal("approve"),
  deliveryId: z.string().trim().min(1),
  warehouseId: z.string().trim().min(1),
  deliveryDate: z.string().trim().min(8),
});

const actionSchema = z.discriminatedUnion("action", [createSchema, approveSchema]);

function year() {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Pacific/Port_Moresby",
      year: "numeric",
    }).format(new Date()),
  );
}

async function resolveSalesOrder(ref: string) {
  return prisma.quote.findFirst({
    where: { OR: [{ id: ref }, { code: ref }] },
    include: {
      customer: { select: { code: true, name: true } },
      project: { select: { code: true, name: true } },
      lines: { include: { item: true }, orderBy: { lineNo: "asc" } },
    },
  });
}

function mapDeliveryNote(note: any, order: any = null) {
  return {
    deliveryId: note.id,
    deliveryNumber: note.code,
    deliveryDate: note.deliveryDate?.toISOString?.().slice(0, 10) || String(note.deliveryDate || "").slice(0, 10),
    sourceDocumentId: note.salesOrderId,
    salesOrderId: note.salesOrderId,
    customerId: order?.customer?.code || "",
    customerName: order?.customer?.name || "",
    projectId: order?.project?.code || "",
    projectName: order?.project?.name || "",
    status: String(note.status || "DRAFT").toUpperCase(),
    warehouseId: note.warehouseId || "",
    journalId: note.journalId || "",
    note: note.note || "",
    totalAmount: Number(order?.total || 0),
    createdAt: note.createdAt?.toISOString?.() || String(note.createdAt || ""),
    approvedAt: note.approvedAt?.toISOString?.() || "",
    lines: (order?.lines || []).map((line: any) => ({
      lineId: line.id,
      itemId: line.itemId || "",
      itemCode: line.item?.code || line.itemId || "",
      itemName: line.item?.name || line.description || "",
      itemType: line.item?.type === "GOOD" ? "STOCK" : line.item?.type === "SERVICE" ? "SERVICE" : "NON_STOCK",
      description: line.description || "",
      qty: Number(line.quantity || 0),
      uom: line.unit || line.item?.unit || "Each",
    })),
  };
}

export async function GET(request: Request) {
  try {
    await requirePermission("sales.read");
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) throw new Error("Delivery Note ID / number is required");
    const note = await prisma.deliveryNote.findFirst({ where: { OR: [{ id }, { code: id }] } });
    if (!note) throw new Error("Delivery Note not found");
    const order = await resolveSalesOrder(note.salesOrderId);
    if (!order) throw new Error("Source Sales Order not found");
    return NextResponse.json({ ok: true, deliveryNote: mapDeliveryNote(note, order) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery Note load failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("sales.write");
    const input = actionSchema.parse(await request.json());

    if (input.action === "createDraft") {
      const order = await resolveSalesOrder(input.salesOrderId);
      if (!order || !order.code.toUpperCase().startsWith("SO-")) {
        throw new Error("Delivery Note source must be a valid Sales Order");
      }
      if (!["ACCEPTED", "PART_DELIVERED"].includes(String(order.status || "").toUpperCase())) {
        throw new Error(`Delivery Note can only be created from an approved Sales Order. Current status: ${order.status}`);
      }
      const existing = await prisma.deliveryNote.findFirst({
        where: {
          salesOrderId: order.id,
          status: { in: ["DRAFT", "POSTED"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          deliveryNote: mapDeliveryNote(existing, order),
          existing: true,
          message: existing.status === "DRAFT" ? "Existing Draft Delivery Note opened." : "Existing posted Delivery Note opened.",
        });
      }

      const created = await prisma.deliveryNote.create({
        data: {
          code: documentSeriesId("DN", year()),
          salesOrderId: order.id,
          deliveryDate: new Date(`${input.deliveryDate.slice(0, 10)}T00:00:00+10:00`),
          status: "DRAFT",
          createdBy: "sales-delivery-note",
        },
      });
      return NextResponse.json({
        ok: true,
        deliveryNote: mapDeliveryNote(created, order),
        message: "Draft Delivery Note created. Select warehouse and approve to post Stock Out / COGS.",
      });
    }

    const note = await prisma.deliveryNote.findFirst({
      where: { OR: [{ id: input.deliveryId }, { code: input.deliveryId }] },
    });
    if (!note) throw new Error("Delivery Note not found");
    if (String(note.status || "").toUpperCase() === "POSTED") {
      const order = await resolveSalesOrder(note.salesOrderId);
      return NextResponse.json({ ok: true, deliveryNote: mapDeliveryNote(note, order), existing: true, message: "Delivery Note is already posted." });
    }
    if (String(note.status || "").toUpperCase() !== "DRAFT") {
      throw new Error(`Only a Draft Delivery Note can be approved. Current status: ${note.status}`);
    }

    await ensureAccountingInfrastructure();
    const defaults = await loadConfiguredPostingAccounts();
    const result = await postSalesDeliveryAtomic({
      deliveryNumber: note.code,
      postingDate: normalizeAccountingDate(input.deliveryDate),
      salesOrderRef: note.salesOrderId,
      warehouseRef: input.warehouseId,
      inventoryAccountId: defaults.defaultInventoryAccount,
      defaultCostAccountId: defaults.defaultCostOfGoodsSoldAccount,
      createdBy: "sales-delivery-note",
      approvedBy: "Finance Controller",
    });

    const updated = await prisma.deliveryNote.update({
      where: { id: note.id },
      data: {
        deliveryDate: new Date(`${input.deliveryDate.slice(0, 10)}T00:00:00+10:00`),
        status: "POSTED",
        warehouseId: result.warehouse.id,
        journalId: result.journalId || null,
        approvedBy: "Finance Controller",
        approvedAt: new Date(),
      },
    });
    const order = await resolveSalesOrder(note.salesOrderId);

    return NextResponse.json({
      ok: true,
      deliveryNote: mapDeliveryNote(updated, order),
      posting: result,
      message: result.noStock
        ? "Delivery Note approved. No stock lines required Stock Out."
        : `Delivery Note ${updated.code} approved and Stock Out / COGS posted.`,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error
        ? error.message
        : "Delivery Note action failed";
    console.error("sales-delivery-note.failed", { message });
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 },
    );
  }
}
