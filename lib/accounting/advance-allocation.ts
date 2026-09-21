import { prisma } from "@/src/lib/prisma";
import { round2 } from "@/lib/accounting/inventory";
import {
  allocateAdvancePaymentAtomic,
  documentPaymentAllocationTotal,
  paymentAllocationSummary,
} from "@/lib/accounting/payment-allocation";

export type AdvancePartyType = "Customer" | "Supplier";
export type AdvanceDocumentType = "Sales Invoice" | "Supplier Invoice";

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function allocationRows(partyType: AdvancePartyType) {
  const rows = await prisma.paymentAllocation.findMany({
    where: {
      status: "POSTED",
      allocationType: "ADVANCE",
      payment: partyType === "Customer"
        ? { customerId: { not: null } }
        : { supplierId: { not: null } },
    },
    include: {
      payment: true,
      invoice: { select: { id: true, code: true } },
      bill: { select: { id: true, code: true } },
    },
    orderBy: [{ allocationDate: "asc" }, { createdAt: "asc" }],
  });

  // Compatibility projection for older UI/report callers that previously
  // consumed advance allocations from PaymentSchedule rows.
  return rows.map((row) => ({
    scheduleId: row.id,
    allocationId: row.id,
    allocationCode: row.code,
    sourceType: partyType === "Customer"
      ? "CUSTOMER_ADVANCE_ALLOCATION"
      : "SUPPLIER_ADVANCE_ALLOCATION",
    sourceId: row.paymentId,
    milestone: row.invoiceId || row.billId || "",
    againstDocumentType: row.invoiceId ? "Sales Invoice" : "Supplier Invoice",
    againstDocumentId: row.invoiceId || row.billId || "",
    againstDocumentNumber: row.invoice?.code || row.bill?.code || "",
    dueDate: row.allocationDate.toISOString().slice(0, 10),
    amount: Number(row.amount || 0),
    status: row.status,
    journalId: row.journalId || "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function advanceAllocationSummary(payment: any) {
  const paymentRef = String(payment?.paymentId || payment?.id || payment?.paymentNumber || "").trim();
  if (!paymentRef) {
    return {
      allocatedAmount: 0,
      remainingAmount: Number(payment?.amount || 0),
      allocations: [] as any[],
    };
  }
  return paymentAllocationSummary(paymentRef);
}

export async function documentAdvanceAllocated(
  partyType: AdvancePartyType,
  documentId: string,
) {
  const customer = partyType === "Customer";
  const document = customer
    ? await prisma.invoice.findFirst({
        where: { OR: [{ id: documentId }, { code: documentId }] },
        select: { id: true },
      })
    : await prisma.supplierBill.findFirst({
        where: { OR: [{ id: documentId }, { code: documentId }] },
        select: { id: true },
      });
  if (!document) return 0;

  const result = await prisma.paymentAllocation.aggregate({
    where: {
      status: "POSTED",
      allocationType: "ADVANCE",
      ...(customer
        ? { invoiceId: document.id }
        : { billId: document.id }),
    },
    _sum: { amount: true },
  });
  return round2(Number(result._sum.amount || 0));
}

/**
 * Compatibility read helper. PaymentAllocation is now the settlement authority;
 * this function no longer rebuilds settlement from Payment.invoiceId/billId or
 * PaymentSchedule side tables.
 */
export async function synchronizeSettlement(
  partyType: AdvancePartyType,
  documentId: string,
) {
  const customer = partyType === "Customer";
  const document = customer
    ? await prisma.invoice.findFirst({
        where: { OR: [{ id: documentId }, { code: documentId }] },
      })
    : await prisma.supplierBill.findFirst({
        where: { OR: [{ id: documentId }, { code: documentId }] },
      });
  if (!document) throw new Error(`${customer ? "Sales Invoice" : "Supplier Invoice"} not found`);

  const totalAllocated = await documentPaymentAllocationTotal(
    customer ? "Sales Invoice" : "Supplier Invoice",
    document.id,
  );
  const advanceAllocated = await documentAdvanceAllocated(partyType, document.id);

  return {
    total: Number(document.total || 0),
    directPaid: round2(totalAllocated - advanceAllocated),
    advanceAllocated,
    settled: totalAllocated,
    outstandingAmount: Number(document.outstanding || 0),
    status: document.status,
  };
}

export async function allocateAdvancePartial(input: {
  paymentId: string;
  againstDocumentType: AdvanceDocumentType;
  againstDocumentId: string;
  amount?: number;
  allocationDate?: string;
  idempotencyKey?: string;
}) {
  const allocationDate = String(input.allocationDate || localDate());
  const summary = await paymentAllocationSummary(input.paymentId);
  if (summary.remainingAmount <= 0.001) {
    throw new Error("This advance has no unallocated balance remaining");
  }

  const document = input.againstDocumentType === "Sales Invoice"
    ? await prisma.invoice.findFirst({
        where: {
          OR: [
            { id: input.againstDocumentId },
            { code: input.againstDocumentId },
          ],
        },
        select: { outstanding: true },
      })
    : await prisma.supplierBill.findFirst({
        where: {
          OR: [
            { id: input.againstDocumentId },
            { code: input.againstDocumentId },
          ],
        },
        select: { outstanding: true },
      });
  if (!document) throw new Error(`${input.againstDocumentType} not found`);

  const outstanding = round2(Number(document.outstanding || 0));
  if (outstanding <= 0.001) {
    throw new Error(`${input.againstDocumentType} has no outstanding balance`);
  }

  const requested = Number(input.amount || 0);
  const amount = round2(
    requested > 0
      ? requested
      : Math.min(summary.remainingAmount, outstanding),
  );

  const result = await allocateAdvancePaymentAtomic({
    paymentId: input.paymentId,
    againstDocumentType: input.againstDocumentType,
    againstDocumentId: input.againstDocumentId,
    amount,
    allocationDate,
    idempotencyKey: input.idempotencyKey,
    createdBy: "advance-allocation",
    approvedBy: "Finance Controller",
  });

  return {
    paymentId: result.paymentId,
    againstDocumentId: input.againstDocumentId,
    journalId: result.journalId,
    allocationId: result.allocationId,
    allocationCode: result.allocationCode,
    allocatedAmount: result.allocatedAmount,
    remainingAdvance: result.remainingAdvance,
    documentOutstanding: result.documentOutstanding,
    documentStatus: Number(result.documentOutstanding || 0) <= 0.001
      ? "PAID"
      : "PARTLY_PAID",
    alreadyAllocated: result.alreadyAllocated,
  };
}
