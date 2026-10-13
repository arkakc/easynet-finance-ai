import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser, hasPermission, type Permission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { findRecords } from "@/lib/backend/apps-script";
import { readEvidenceFile, saveEvidenceFile } from "@/lib/documents/evidence-storage";

const config: Record<string, { read: Permission; write: Permission; docType: "QUOTE" | "INVOICE" | "PURCHASE_ORDER" | "BILL" | "RECEIPT" | "OTHER"; documentTypes: string[]; table: string; idField: string }> = {
  quote: { read: "sales.read", write: "sales.write", docType: "QUOTE", documentTypes: ["QUOTE", "SALES_ORDER"], table: "Quotes", idField: "quoteId" },
  invoice: { read: "sales.read", write: "sales.write", docType: "INVOICE", documentTypes: ["INVOICE", "SALES_INVOICE"], table: "Invoices", idField: "invoiceId" },
  purchaseOrder: { read: "purchase.read", write: "purchase.write", docType: "PURCHASE_ORDER", documentTypes: ["PO", "PURCHASE_ORDER"], table: "PurchaseOrders", idField: "poId" },
  supplierBill: { read: "purchase.read", write: "purchase.write", docType: "BILL", documentTypes: ["BILL", "SUPPLIER_INVOICE"], table: "SupplierBills", idField: "billId" },
  payment: { read: "dashboard.read", write: "accounts.write", docType: "RECEIPT", documentTypes: ["PAYMENT", "RECEIPT"], table: "Payments", idField: "paymentId" },
  expense: { read: "purchase.read", write: "purchase.write", docType: "OTHER", documentTypes: ["EXPENSE"], table: "Expenses", idField: "expenseId" },
};
async function access(type: string, write = false) {
  const user = await getCurrentUser();
  const selected = config[type];
  if (!user || !selected || !hasPermission(user, write ? selected.write : selected.read)) return null;
  return { user, selected };
}
function validId(id: string) { return id.length > 0 && id.length <= 180; }

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const type = String(form.get("type") || "");
  const id = String(form.get("id") || "").trim();
  const auth = await access(type, true);
  if (!auth) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  if (!validId(id) || !auth.user.userId) return NextResponse.json({ ok: false, error: "Invalid document" }, { status: 400 });
  const parent = await findRecords<Record<string, unknown>>(auth.selected.table, { [auth.selected.idField]: id }, 1);
  if (!parent.rows.length) return NextResponse.json({ ok: false, error: "Source transaction not found" }, { status: 404 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "File is required" }, { status: 400 });
  try {
    const saved = await saveEvidenceFile(file);
    const result = await prisma.document.create({ data: {
      code: `EVD-${randomUUID()}`, type: auth.selected.docType,
      name: file.name.slice(0, 180) || "Document evidence", documentId: id,
      documentType: auth.selected.documentTypes[0], createdBy: auth.user.userId,
      fileUrl: saved.location, fileSize: saved.size, mimeType: saved.mime,
    }, select: { id: true, code: true } });
    return NextResponse.json({ ok: true, attachment: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Evidence upload failed" }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  const attachmentId = req.nextUrl.searchParams.get("attachmentId") || "";
  const auth = await access(type);
  if (!auth) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  if (!validId(id) || !attachmentId) return NextResponse.json({ ok: false, error: "Invalid file request" }, { status: 400 });
  const attachment = await prisma.document.findFirst({
    where: { id: attachmentId, documentId: id, documentType: { in: auth.selected.documentTypes } },
    select: { fileUrl: true, mimeType: true, name: true },
  });
  if (!attachment?.fileUrl?.startsWith("evidence:")) return NextResponse.json({ ok: false, error: "Private file unavailable" }, { status: 404 });
  try {
    const bytes = await readEvidenceFile(attachment.fileUrl);
    const contentType = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(attachment.mimeType || "") ? attachment.mimeType! : "application/octet-stream";
    const preview = req.nextUrl.searchParams.get("preview") === "1";
    const safeName = (attachment.name || "evidence").replace(/[\r\n"\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch {
    return NextResponse.json({ ok: false, error: "Private file unavailable" }, { status: 404 });
  }
}
