import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

type PlannedAdvance = { paymentId: string; amount: number };

const round2 = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function normalizePlan(value: unknown): PlannedAdvance[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row: any) => ({
      paymentId: String(row?.paymentId || "").trim(),
      amount: round2(Number(row?.amount || 0)),
    }))
    .filter((row) => row.paymentId && row.amount > 0);
}

async function loadWorkspace(billRef: string) {
  const bill = await prisma.supplierBill.findFirst({
    where: { OR: [{ id: billRef }, { code: billRef }] },
    include: {
      order: { select: { id: true, code: true } },
    },
  });
  if (!bill) throw new Error("Supplier Invoice not found");

  const poRefs = [
    bill.orderId,
    bill.sourceDocId,
    bill.poReference,
    bill.order?.id,
    bill.order?.code,
  ].map((value) => String(value || "").trim()).filter(Boolean);

  const payments = poRefs.length
    ? await prisma.payment.findMany({
        where: {
          supplierId: bill.supplierId,
          type: "SUPPLIER_PAYMENT",
          status: "CLEARED",
          journalId: { not: null },
          sourceDocId: { in: [...new Set(poRefs)] },
        },
        include: {
          allocations: {
            where: { status: "POSTED" },
            select: { amount: true },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const plan = normalizePlan(bill.plannedAdvanceAllocations);
  const availableAdvances = payments.map((payment) => {
    const allocated = round2(
      payment.allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    );
    const available = round2(Math.max(0, Number(payment.amount || 0) - allocated));
    const planned = plan.find((row) => row.paymentId === payment.id)?.amount || 0;
    return {
      paymentId: payment.id,
      paymentNumber: payment.code,
      amount: Number(payment.amount || 0),
      allocated,
      available,
      planned,
      status: payment.status,
      journalId: payment.journalId || "",
      createdAt: payment.createdAt.toISOString(),
    };
  }).filter((row) => row.available > 0.001 || row.planned > 0.001);

  const plannedTotal = round2(plan.reduce((sum, row) => sum + row.amount, 0));
  const total = Number(bill.total || 0);
  const postedPaid = Number(bill.amountPaid || 0);
  const projectedOutstanding = round2(Math.max(0, total - postedPaid - plannedTotal));

  return {
    bill,
    plan,
    availableAdvances,
    plannedTotal,
    projectedOutstanding,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission("purchase.read");
    const billId = String(request.nextUrl.searchParams.get("billId") || "").trim();
    if (!billId) {
      return NextResponse.json({ ok: false, error: "Supplier Invoice is required" }, { status: 400 });
    }
    const workspace = await loadWorkspace(billId);
    return NextResponse.json({
      ok: true,
      status: workspace.bill.status,
      plan: workspace.plan,
      plannedTotal: workspace.plannedTotal,
      projectedOutstanding: workspace.projectedOutstanding,
      availableAdvances: workspace.availableAdvances,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier Advance plan load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission("purchase.write");
    const body = await request.json() as { billId?: string; allocations?: PlannedAdvance[] };
    const billId = String(body.billId || "").trim();
    if (!billId) throw new Error("Supplier Invoice is required");

    const workspace = await loadWorkspace(billId);
    if (workspace.bill.status !== "DRAFT") {
      throw new Error("Supplier Advance can only be planned while the Supplier Invoice is DRAFT");
    }

    const requested = normalizePlan(body.allocations);
    const availableByPayment = new Map(
      workspace.availableAdvances.map((row) => [row.paymentId, row]),
    );

    let total = 0;
    for (const row of requested) {
      const advance = availableByPayment.get(row.paymentId);
      if (!advance) throw new Error("Selected Supplier Advance is not finalized, linked to this Purchase Order, or no longer available");
      if (row.amount > advance.available + 0.001) {
        throw new Error(
          `Planned allocation for ${advance.paymentNumber} exceeds available advance K${advance.available.toFixed(2)}`,
        );
      }
      total = round2(total + row.amount);
    }

    const invoiceAvailable = round2(
      Math.max(0, Number(workspace.bill.total || 0) - Number(workspace.bill.amountPaid || 0)),
    );
    if (total > invoiceAvailable + 0.001) {
      throw new Error(
        `Planned Supplier Advance K${total.toFixed(2)} exceeds Supplier Invoice outstanding K${invoiceAvailable.toFixed(2)}`,
      );
    }

    await prisma.supplierBill.update({
      where: { id: workspace.bill.id },
      data: {
        plannedAdvanceAllocations: JSON.stringify(requested),
        updatedBy: "supplier-invoice-advance-plan",
      },
    });

    return NextResponse.json({
      ok: true,
      plan: requested,
      plannedTotal: total,
      projectedOutstanding: round2(invoiceAvailable - total),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier Advance plan save failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}
