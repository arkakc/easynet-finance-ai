import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";
import { allocateAdvancePartial, advanceAllocationSummary } from "@/lib/accounting/advance-allocation";

function sourceMarker(payment: any, prefix: "SQ" | "PO") {
  const match = String(payment?.reference || "").match(new RegExp(`^${prefix}:([^|]+)\\|`));
  return match?.[1] || "";
}

async function assertSourceChain(payment: any, againstDocumentId: string) {
  const partyType = String(payment.partyType || "");
  const linkedSource = String(payment.sourceDocumentId || "").trim()
    || (partyType === "Supplier" ? sourceMarker(payment, "PO") : sourceMarker(payment, "SQ"));
  if (!linkedSource) return;

  if (partyType === "Supplier") {
    const bill = (await findRecords<any>("SupplierBills", { billId: againstDocumentId }, 1)).rows[0];
    if (!bill) throw new Error("Supplier Invoice not found");
    const billPo = String(bill.poId || bill.sourceDocumentId || "").trim();
    if (billPo !== linkedSource) {
      throw new Error("This Supplier Advance is linked to a different Purchase Order and cannot be allocated to this Supplier Invoice");
    }
    return;
  }

  const invoice = (await findRecords<any>("Invoices", { invoiceId: againstDocumentId }, 1)).rows[0];
  if (!invoice) throw new Error("Sales Invoice not found");
  if (String(invoice.invoiceNumber || "").toUpperCase().startsWith("CN-")) throw new Error("Customer Advances cannot be allocated to Sales Credit Notes");
  if (String(invoice.sourceDocumentId || "").trim() !== linkedSource) {
    throw new Error("This Customer Advance is linked to a different Sales Quotation and cannot be allocated to this Sales Invoice");
  }
}

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
      idempotencyKey?: string;
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
    await assertSourceChain(payment, againstDocumentId);
    const result = await allocateAdvancePartial({
      paymentId,
      againstDocumentType,
      againstDocumentId,
      amount: Number(body.amount || 0),
      allocationDate: String(body.allocationDate || ""),
      idempotencyKey: String(body.idempotencyKey || "").trim() || undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Advance allocation failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
