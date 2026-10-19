import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
const lineSchema = z.object({ itemId: z.string().trim().min(1), qty: z.coerce.number().finite().positive().max(100000000) });
const createSchema = z.object({
  action: z.literal("create"),
  receiptId: z.string().trim().min(1),
  reason: z.string().trim().min(8).max(500),
  lines: z.array(lineSchema).min(1).max(100),
});
const approveSchema = z.object({ action: z.literal("approve"), returnId: z.string().trim().min(1) });
const cancelSchema = z.object({ action: z.literal("cancel"), returnId: z.string().trim().min(1) });
const inputSchema = z.discriminatedUnion("action", [createSchema, approveSchema, cancelSchema]);

type ReturnLine = z.infer<typeof lineSchema>;
function parseLines(json: string): ReturnLine[] {
  try { return z.array(lineSchema).parse(JSON.parse(json)); } catch { return []; }
}
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Purchase return request failed";
  return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
}
export async function GET() {
  try {
    await requirePermission("purchase.read");
    const [returns, receipts] = await Promise.all([
      prisma.purchaseReturn.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.purchaseReceipt.findMany({ where: { status: "POSTED", journalId: { not: null }, warehouseId: { not: null } }, orderBy: { receiptDate: "desc" }, take: 100 }),
    ]);
    const orders = await prisma.purchaseOrder.findMany({
      where: { id: { in: [...new Set(receipts.map(row => row.purchaseOrderId))] } },
      include: { supplier: { select: { name: true } } },
    });
    const byOrder = new Map(orders.map(order => [order.id, order]));
    return NextResponse.json({
      ok: true,
      returns: returns.map(row => ({ ...row, lines: parseLines(row.linesJson), linesJson: undefined })),
      receipts: receipts.filter(receipt => byOrder.has(receipt.purchaseOrderId)).map(receipt => ({
        id: receipt.id, code: receipt.code, date: receipt.receiptDate.toISOString().slice(0, 10),
        supplier: byOrder.get(receipt.purchaseOrderId)?.supplier.name || "",
        orderCode: byOrder.get(receipt.purchaseOrderId)?.code || "",
      })),
    });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requirePermission("purchase.write");
    const data = inputSchema.parse(await request.json());
    if (data.action === "create") {
      if (new Set(data.lines.map(line => line.itemId)).size !== data.lines.length) throw new Error("Duplicate item lines are not allowed.");
      return NextResponse.json(await prisma.$transaction(async tx => {
        const receipt = await tx.purchaseReceipt.findFirst({
          where: { OR: [{ id: data.receiptId }, { code: data.receiptId }] },
        });
        if (!receipt || receipt.status !== "POSTED" || !receipt.journalId || !receipt.warehouseId) throw new Error("Select a posted GRN with a warehouse and journal.");
        const order = await tx.purchaseOrder.findUnique({ where: { id: receipt.purchaseOrderId }, include: { lines: true } });
        if (!order) throw new Error("Purchase order for GRN could not be found.");
        const received: ReturnLine[] = JSON.parse(receipt.items || "[]").map((line: Record<string, unknown>) => ({
          itemId: String(line.itemId || line.itemRef || ""), qty: Number(line.qty || line.quantity || 0),
        }));
        const outstanding = await tx.purchaseReturn.findMany({ where: { receiptId: receipt.id, status: { not: "CANCELLED" } }, select: { linesJson: true } });
        for (const line of data.lines) {
          const accepted = received.filter(row => row.itemId === line.itemId).reduce((sum, row) => sum + row.qty, 0);
          const reserved = outstanding.flatMap(row => parseLines(row.linesJson)).filter(row => row.itemId === line.itemId).reduce((sum, row) => sum + row.qty, 0);
          if (accepted <= 0 || line.qty > accepted - reserved + 0.000001) throw new Error("Return quantity exceeds available received quantity for item " + line.itemId);
          const item = await tx.item.findUnique({ where: { id: line.itemId }, select: { type: true } });
          if (item?.type !== "GOOD") throw new Error("Only stock goods can be returned against a posted GRN.");
        }
        const code = "PRET-" + randomUUID().slice(0, 12).toUpperCase();
        const saved = await tx.purchaseReturn.create({ data: {
          code, receiptId: receipt.id, purchaseOrderId: order.id, supplierId: order.supplierId,
          warehouseId: receipt.warehouseId, reason: data.reason, linesJson: JSON.stringify(data.lines),
          createdBy: actor.email,
        } });
        return { ok: true, purchaseReturn: { id: saved.id, code: saved.code, status: saved.status }, message: "Draft return request saved; no inventory, GST or GL posting occurred." };
      }, { isolationLevel: "Serializable" }));
    }
    if (data.action === "approve") {
      await requirePermission("post.approve");
      const result = await prisma.purchaseReturn.updateMany({ where: { id: data.returnId, status: "DRAFT" }, data: { status: "APPROVED", approvedBy: actor.email, approvedAt: new Date() } });
      if (result.count !== 1) throw new Error("Only a draft request can be approved; refresh to check current status.");
      return NextResponse.json({ ok: true, status: "APPROVED", message: "Return request approved for financial processing. Stock and Supplier Debit Note posting are not yet enabled." });
    }
    const result = await prisma.purchaseReturn.updateMany({ where: { id: data.returnId, status: "DRAFT" }, data: { status: "CANCELLED" } });
    if (result.count !== 1) throw new Error("Only draft return requests can be cancelled.");
    return NextResponse.json({ ok: true, status: "CANCELLED" });
  } catch (error) { return fail(error); }
}
