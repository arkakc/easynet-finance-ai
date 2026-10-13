import { NextRequest, NextResponse } from "next/server";
import { requirePermission, type Permission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const types: Record<string, { permission: Permission; entity: string; documentTypes: string[] }> = {
  quote: { permission: "sales.read", entity: "Quote", documentTypes: ["QUOTE", "SALES_ORDER"] },
  invoice: { permission: "sales.read", entity: "Invoice", documentTypes: ["INVOICE", "SALES_INVOICE"] },
  purchaseOrder: { permission: "purchase.read", entity: "PurchaseOrder", documentTypes: ["PO", "PURCHASE_ORDER"] },
  supplierBill: { permission: "purchase.read", entity: "SupplierBill", documentTypes: ["BILL", "SUPPLIER_INVOICE"] },
  payment: { permission: "dashboard.read", entity: "Payment", documentTypes: ["PAYMENT", "RECEIPT"] },
  expense: { permission: "purchase.read", entity: "Expense", documentTypes: ["EXPENSE", "OTHER"] },
};

/** Read-only evidence and audit activities, always scoped by document type and ID. */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "";
  const id = req.nextUrl.searchParams.get("id")?.trim() || "";
  const config = types[type];
  if (!config || !id || id.length > 180) return NextResponse.json({ ok: false, error: "Invalid document" }, { status: 400 });
  await requirePermission(config.permission);
  const [attachments, events] = await Promise.all([
    prisma.document.findMany({
      where: { documentId: id, documentType: { in: config.documentTypes } },
      select: { id: true, code: true, name: true, status: true, mimeType: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    }),
    prisma.auditLog.findMany({
      where: { OR: [
        { entityType: { in: [config.entity, type] }, entityId: id },
        { entityType: { in: [config.entity, type] }, entityCode: id },
      ] },
      select: { id: true, action: true, description: true, outcome: true, actorEmail: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    }),
  ]);
  return NextResponse.json({ ok: true, attachments, events });
}
