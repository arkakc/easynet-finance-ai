import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@prisma/client";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { ensurePaymentScheduleInfrastructure } from "@/lib/accounting/payment-schedule-store";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";

const requestSchema = z.object({
  scheduleId: z.string().trim().min(1),
  action: z.enum(["preview", "recognize"]),
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type Schedule = {
  scheduleId: string; sourceId: string; milestone: string;
  dueDate: string | null; amount: number | string; status: string;
};
const cents = (amount: unknown) => Math.round(Number(amount) * 100) / 100;

export async function POST(request: Request) {
  try {
    await requirePermission("post.approve");
    const input = requestSchema.parse(await request.json());
    const date = new Date(input.postingDate + "T00:00:00Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.postingDate) {
      throw new Error("Invalid posting date");
    }
    const currentDay = new Date().toISOString().slice(0, 10);
    if (input.postingDate > currentDay) throw new Error("Future-dated revenue recognition is not permitted");
    await ensurePaymentScheduleInfrastructure(prisma);
    const accounts = await loadConfiguredPostingAccounts();
    const result = await runAtomicAccounting(async ({ tx, postJournal }) => {
      const rows = await tx.$queryRaw<Schedule[]>(Prisma.sql`
        SELECT "scheduleId", "sourceId", "milestone", "dueDate", "amount", "status"
        FROM "PaymentSchedule" WHERE "scheduleId" = ${input.scheduleId}
          AND "sourceType" = 'DEFERRED_REVENUE'
      `);
      const row = rows[0];
      if (!row) throw new Error("Deferred revenue schedule not found");
      if (row.status !== "PENDING") throw new Error("This schedule is no longer pending");
      if (!row.dueDate || row.dueDate > input.postingDate) throw new Error("Recognition period has not ended");
      const [lineId, incomeAccount] = row.milestone.split("|");
      if (!lineId || !incomeAccount) throw new Error("Legacy schedule has no traceable revenue account");
      const amount = cents(row.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid recognition amount");
      const invoice = await tx.invoice.findUnique({ where: { id: row.sourceId } });
      if (!invoice || !invoice.glPosted || ["CANCELLED", "VOID", "DRAFT"].includes(invoice.status)) {
        throw new Error("Recognition requires an active posted source invoice");
      }
      // This version safely supports only base-currency invoices. FX recognition
      // needs a separately reviewed exchange-rate and base-amount policy.
      if (invoice.currency !== "PGK") throw new Error("Foreign currency schedules require review before recognition");
      const line = await tx.invoiceLine.findUnique({ where: { id: lineId } });
      if (!line || line.invoiceId !== invoice.id) throw new Error("Invoice line does not match the schedule");
      if (input.action === "preview") return { preview: true, scheduleId: row.scheduleId, amount, postingDate: input.postingDate, incomeAccount };
      const journal = await postJournal({
        postingDate: input.postingDate,
        documentType: "DEFERRED_REVENUE",
        documentId: row.scheduleId,
        documentNumber: row.scheduleId,
        reference: `Deferred revenue recognition: ${row.scheduleId}`,
        projectId: invoice.projectId || undefined,
        lines: [
          { accountId: accounts.defaultDeferredRevenueAccount, debit: amount, customerId: invoice.customerId, projectId: invoice.projectId || undefined, description: "Release unearned revenue" },
          { accountId: incomeAccount, credit: amount, customerId: invoice.customerId, projectId: invoice.projectId || undefined, description: "Recognize earned revenue" },
        ],
      });
      const changed = await tx.$executeRaw(Prisma.sql`
        UPDATE "PaymentSchedule" SET "status" = 'COMPLETED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "scheduleId" = ${row.scheduleId} AND "status" = 'PENDING'
      `);
      if (changed !== 1) throw new Error("Schedule was modified concurrently");
      return { preview: false, scheduleId: row.scheduleId, journalId: journal.journalId, amount };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Recognition failed" }, { status: 400 });
  }
}
