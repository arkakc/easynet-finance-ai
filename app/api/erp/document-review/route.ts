import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser, hasPermission, type Permission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { findRecords } from "@/lib/backend/apps-script";
import { POST as approvalsPost } from "@/app/api/approvals/route";
import { env } from "@/lib/env";

const supported = {
  quote: { table: "Quotes", key: "quoteId", write: "sales.write" },
  invoice: { table: "Invoices", key: "invoiceId", write: "sales.write" },
  purchaseOrder: { table: "PurchaseOrders", key: "poId", write: "purchase.write" },
  supplierBill: { table: "SupplierBills", key: "billId", write: "purchase.write" },
  payment: { table: "Payments", key: "paymentId", write: "accounts.write" },
  expense: { table: "Expenses", key: "expenseId", write: "purchase.write" },
} as const satisfies Record<string, {table: string; key: string; write: Permission}>;
type Kind = keyof typeof supported;
function kindOf(value: string): Kind | null { return Object.prototype.hasOwnProperty.call(supported, value) ? value as Kind : null; }
async function source(kind: Kind, id: string) {
  const c = supported[kind];
  return (await findRecords<Record<string, unknown>>(c.table, { [c.key]: id }, 1)).rows[0];
}
const tag = (kind: Kind) => "PHASE3_" + kind.toUpperCase() + "_REVIEW";
function bad(error: string, status: number) { return NextResponse.json({ ok: false, error }, { status }); }
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const kind = kindOf(req.nextUrl.searchParams.get("type") || "");
  const id = req.nextUrl.searchParams.get("id")?.trim() || "";
  if (!user || !kind || !id || id.length > 180) return bad("Invalid request", 400);
  if (!hasPermission(user, supported[kind].write) && !hasPermission(user, "post.approve")) return bad("Forbidden", 403);
  const record = await source(kind, id);
  if (!record) return bad("Document not found", 404);
  const review = await prisma.approvalRequest.findFirst({ where: { type: tag(kind), documentCode: id }, orderBy: { createdAt: "desc" },
    select: { id: true, status: true, requestedBy: true, requestedAt: true, approverComment: true, rejectionReason: true } });
  return NextResponse.json({ ok: true, status: String(record.status || "DRAFT"), review, canSubmit: hasPermission(user, supported[kind].write), canReview: hasPermission(user, "post.approve") });
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.userId) return bad("Unauthorized", 401);
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) return bad("Cross-origin action blocked", 403);
  let body: { type?: string; id?: string; action?: string; note?: string };
  try { body = await req.json(); } catch { return bad("Invalid JSON", 400); }
  const kind = kindOf(body.type || "");
  const id = String(body.id || "").trim();
  const action = String(body.action || "").toUpperCase();
  const note = String(body.note || "").trim().slice(0, 500);
  if (!kind || !id || id.length > 180 || !["SUBMIT", "REJECT", "APPROVE"].includes(action)) return bad("Invalid workflow action", 400);
  const c = supported[kind];
  if (!hasPermission(user, action === "SUBMIT" ? c.write : "post.approve")) return bad("Forbidden", 403);
  const record = await source(kind, id);
  if (!record) return bad("Document not found", 404);
  if (String(record.status || "DRAFT").toUpperCase() !== "DRAFT") return bad("Only draft documents can enter review", 409);
  const previous = await prisma.approvalRequest.findFirst({ where: { type: tag(kind), documentCode: id }, orderBy: { createdAt: "desc" } });
  if (action === "SUBMIT") {
    if (previous && ["PENDING", "IN_REVIEW"].includes(previous.status)) return bad("Review already submitted", 409);
    const review = await prisma.approvalRequest.create({ data: { code: "P3-" + randomUUID(), type: tag(kind), documentType: kind, documentCode: id,
      requestedBy: user.userId, status: "PENDING", priority: "NORMAL" } });
    await prisma.auditLog.create({ data: { action: "SUBMIT", entityType: kind, entityId: id, actorEmail: user.email, userId: user.userId,
      description: "Submitted document for review", outcome: "SUCCESS" } });
    return NextResponse.json({ ok: true, review: { id: review.id, status: review.status } });
  }
  if (!previous || !["PENDING", "IN_REVIEW"].includes(previous.status)) return bad("No pending review", 409);
  if (previous.requestedBy === user.userId) return bad("Maker cannot approve or reject own submission", 403);
  if (action === "REJECT") {
    if (!note) return bad("Rejection reason is required", 400);
    const updated = await prisma.approvalRequest.update({ where: { id: previous.id }, data: { status: "REJECTED", approverId: user.userId,
      approverComment: note, rejectionReason: note, rejectedAt: new Date() } });
    await prisma.auditLog.create({ data: { action: "REJECT", entityType: kind, entityId: id, actorEmail: user.email, userId: user.userId,
      description: note, outcome: "SUCCESS" } });
    return NextResponse.json({ ok: true, review: { id: updated.id, status: updated.status } });
  }
  if (!env.APP_SECRET) return bad("APP_SECRET is not configured", 503);
  const upstream = await approvalsPost(new Request(req.url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.APP_SECRET, payload: { recordType: kind, recordId: id, decision: "APPROVE", note: note || "Phase 3 approved review" } }) }));
  const result = await upstream.json();
  if (!upstream.ok || !result.ok) return NextResponse.json({ ok: false, error: result.error || "Approval failed" }, { status: upstream.status });
  await prisma.approvalRequest.update({ where: { id: previous.id }, data: { status: "APPROVED", approverId: user.userId, approvedAt: new Date(), approverComment: note } });
  await prisma.auditLog.create({ data: { action: "APPROVE", entityType: kind, entityId: id, actorEmail: user.email, userId: user.userId,
    description: "Approved submitted review using existing posting workflow", outcome: "SUCCESS" } });
  return NextResponse.json({ ok: true, status: result.status, review: { id: previous.id, status: "APPROVED" } });
}
