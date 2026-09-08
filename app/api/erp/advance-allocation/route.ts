import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";
import { allocateAdvancePartial, advanceAllocationSummary } from "@/lib/accounting/advance-allocation";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const paymentId = url.searchParams.get("paymentId")?.trim() || "";
    if (!paymentId) throw new Error("Advance Payment Entry is required");
    const payment = (await findRecords<any>("Payments", { paymentId }, 1)).rows[0];
    if (!payment) throw new Error("Advance Payment Entry not found");
    const partyType = String(payment.partyType || "");
    await requirePermission(partyType === "Supplier" ? "purchase.read" : "sales.read");
    return NextResponse.json({ ok: true, payment, summary: await advanceAllocationSummary(payment) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Advance allocation summary failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      paymentId?: string;
      partyType?: "Customer" | "Supplier";
      againstDocumentType?: "Sales Invoice" | "Supplier Invoice";
      againstDocumentId?: string;
      amount?: number;
      allocationDate?: string;
    };
    const paymentId = String(body.paymentId || "").trim();
    if (!paymentId) throw new Error("Advance Payment Entry is required");
    const payment = (await findRecords<any>("Payments", { paymentId }, 1)).rows[0];
    if (!payment) throw new Error("Advance Payment Entry not found");
    const partyType = String(payment.partyType || "");
    await requirePermission(partyType === "Supplier" ? "purchase.write" : "sales.write");
    if (body.partyType && body.partyType !== partyType) throw new Error("Advance party type mismatch");
    const againstDocumentType = body.againstDocumentType || (partyType === "Supplier" ? "Supplier Invoice" : "Sales Invoice");
    const againstDocumentId = String(body.againstDocumentId || "").trim();
    if (!againstDocumentId) throw new Error("Against document is required");
    const result = await allocateAdvancePartial({
      paymentId,
      againstDocumentType,
      againstDocumentId,
      amount: Number(body.amount || 0),
      allocationDate: String(body.allocationDate || ""),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Advance allocation failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
