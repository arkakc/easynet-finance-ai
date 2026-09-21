import { prisma } from "@/src/lib/prisma";
import { listPaymentSchedules } from "@/lib/accounting/payment-schedule-store";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const round2 = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function pngDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export async function backfillLegacyPaymentAllocations(options: { apply?: boolean } = {}) {
  const apply = options.apply === true;
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["CLEARED", "CAPTURED"] },
      OR: [
        { invoiceId: { not: null } },
        { billId: { not: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const schedules = (await listPaymentSchedules(10_000, 0))
    .filter((row) =>
      ["CUSTOMER_ADVANCE_ALLOCATION", "SUPPLIER_ADVANCE_ALLOCATION"].includes(
        String(row.sourceType || ""),
      )
      && String(row.status || "").toUpperCase() === "POSTED",
    );

  const plan: Array<{
    source: "PAYMENT_LINK" | "PAYMENT_SCHEDULE";
    paymentId: string;
    invoiceId?: string;
    billId?: string;
    amount: number;
    allocationDate: string;
    allocationType: "DIRECT" | "ADVANCE";
    journalId?: string;
    idempotencyKey: string;
    legacyScheduleId?: string;
  }> = [];

  for (const payment of payments) {
    const targetId = payment.invoiceId || payment.billId;
    if (!targetId) continue;

    const existing = await prisma.paymentAllocation.findFirst({
      where: {
        paymentId: payment.id,
        status: "POSTED",
        ...(payment.invoiceId
          ? { invoiceId: payment.invoiceId }
          : { billId: payment.billId! }),
      },
    });
    if (existing) continue;

    const oldAdvanceJournal = await prisma.journalHeader.findFirst({
      where: {
        sourceDocType: payment.customerId
          ? "CUSTOMER_ADVANCE_ALLOCATION"
          : "SUPPLIER_ADVANCE_ALLOCATION",
        sourceDocId: `${payment.id}-${targetId}`,
        status: "POSTED",
      },
    });

    plan.push({
      source: "PAYMENT_LINK",
      paymentId: payment.id,
      invoiceId: payment.invoiceId || undefined,
      billId: payment.billId || undefined,
      amount: round2(Number(payment.amount || 0)),
      allocationDate: pngDate(oldAdvanceJournal?.date || payment.date),
      allocationType: oldAdvanceJournal ? "ADVANCE" : "DIRECT",
      journalId: oldAdvanceJournal?.code || payment.journalId || undefined,
      idempotencyKey: `MIGRATE:PAYMENT:${payment.id}:${targetId}`,
    });
  }

  for (const schedule of schedules) {
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { id: schedule.sourceId },
          { code: schedule.sourceId },
        ],
      },
    });
    if (!payment) continue;

    const targetRef = String(schedule.milestone || "").trim();
    if (!targetRef) continue;

    const invoice = payment.customerId
      ? await prisma.invoice.findFirst({
          where: { OR: [{ id: targetRef }, { code: targetRef }] },
          select: { id: true },
        })
      : null;
    const bill = payment.supplierId
      ? await prisma.supplierBill.findFirst({
          where: { OR: [{ id: targetRef }, { code: targetRef }] },
          select: { id: true },
        })
      : null;
    if (!invoice && !bill) continue;

    const key = `MIGRATE:SCHEDULE:${schedule.scheduleId}`;
    const existing = await prisma.paymentAllocation.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) continue;

    const journal = await prisma.journalHeader.findFirst({
      where: {
        sourceDocType: String(schedule.sourceType),
        sourceDocId: schedule.scheduleId,
        status: "POSTED",
      },
    });

    plan.push({
      source: "PAYMENT_SCHEDULE",
      paymentId: payment.id,
      invoiceId: invoice?.id,
      billId: bill?.id,
      amount: round2(Number(schedule.amount || 0)),
      allocationDate: String(schedule.dueDate || "").slice(0, 10) || pngDate(journal?.date || payment.date),
      allocationType: "ADVANCE",
      journalId: journal?.code || undefined,
      idempotencyKey: key,
      legacyScheduleId: schedule.scheduleId,
    });
  }

  if (!apply) {
    return {
      mode: "PREVIEW" as const,
      planned: plan.length,
      direct: plan.filter((row) => row.allocationType === "DIRECT").length,
      advance: plan.filter((row) => row.allocationType === "ADVANCE").length,
      rows: plan,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const row of plan) {
      const duplicate = await tx.paymentAllocation.findUnique({
        where: { idempotencyKey: row.idempotencyKey },
      });
      if (duplicate) continue;

      await tx.paymentAllocation.create({
        data: {
          code: documentSeriesId("Payment Allocation"),
          paymentId: row.paymentId,
          invoiceId: row.invoiceId || null,
          billId: row.billId || null,
          allocationDate: new Date(`${row.allocationDate}T00:00:00+10:00`),
          amount: row.amount,
          allocationType: row.allocationType,
          status: "POSTED",
          journalId: row.journalId || null,
          idempotencyKey: row.idempotencyKey,
          createdBy: "phase-5-payment-allocation-backfill",
        },
      });
      count += 1;
    }

    const migratedPaymentIds = [...new Set(
      plan
        .filter((row) => row.source === "PAYMENT_LINK")
        .map((row) => row.paymentId),
    )];
    if (migratedPaymentIds.length) {
      await tx.payment.updateMany({
        where: { id: { in: migratedPaymentIds } },
        data: { invoiceId: null, billId: null },
      });
    }
    return count;
  });

  return {
    mode: "LIVE" as const,
    planned: plan.length,
    created,
    direct: plan.filter((row) => row.allocationType === "DIRECT").length,
    advance: plan.filter((row) => row.allocationType === "ADVANCE").length,
  };
}
