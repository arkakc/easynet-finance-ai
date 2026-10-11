import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireValidatedRequestPermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { createPendingManualJournal } from "@/lib/accounting/manual-journal-approval";
import { GST_SETTLEMENT_PREFIX, gstSettlementBalances } from "@/lib/accounting/gst-settlement";

const inputSchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  bankAccountId: z.string().min(1),
  paymentReference: z.string().trim().min(3).max(100),
});

async function context(paymentDate: string) {
  return prisma.$transaction(async tx => {
    const balances = await gstSettlementBalances(tx, paymentDate);
    const banks = await tx.bankAccount.findMany({
      where: { isActive: true, chartOfAccountsId: { not: null }, currency: "PGK" },
      include: { chartOfAccounts: true },
    });
    return { balances, banks: banks.filter(b => b.chartOfAccounts?.isActive).map(b => ({ id: b.id, name: b.name, code: b.code, ledger: b.chartOfAccounts?.code })) };
  });
}

export async function GET(request: Request) {
  try {
    await requirePermission("accounts.read");
    const date = new URL(request.url).searchParams.get("date") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Select a valid payment date");
    return NextResponse.json({ ok: true, ...(await context(date)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Preview failed" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const maker = await requireValidatedRequestPermission(request, "accounts.write");
    const input = inputSchema.parse(await request.json());
    const result = await prisma.$transaction(async tx => {
      const pending = await tx.journalHeader.findFirst({ where: { status: "PENDING", reference: { startsWith: GST_SETTLEMENT_PREFIX } }, select: { code: true } });
      if (pending) throw new Error("Another GST settlement awaits approval: " + pending.code);
      const calculated = await gstSettlementBalances(tx, input.paymentDate);
      if (calculated.net <= 0) throw new Error("No positive GST payable to settle");
      const bank = await tx.bankAccount.findUnique({ where: { id: input.bankAccountId }, include: { chartOfAccounts: { include: { children: { select: { id: true } } } } } });
      if (!bank?.isActive || bank.currency !== "PGK" || !bank.chartOfAccounts?.isActive || bank.chartOfAccounts.children.length) throw new Error("Select an active PGK bank linked to an active posting ledger");
      if (new Set([calculated.output.id,calculated.input.id]).has(bank.chartOfAccounts.id)) throw new Error("Bank ledger cannot be a GST control account");
      const ref = GST_SETTLEMENT_PREFIX + input.period + ":" + input.paymentReference;
      return createPendingManualJournal({
        entryType: "BANK_ENTRY", journalType: "CASH_DISBURSEMENTS_JOURNAL",
        postingDate: input.paymentDate, reference: ref, remarks: "GST payment subject to approved IRC return and banking evidence",
        makerEmail: maker.email, lines: [
          { accountId: "2120", debit: calculated.outputDue, description: "Clear output GST liability" },
          { accountId: "1140", credit: calculated.inputCredit, description: "Apply eligible input GST credit" },
          { accountId: bank.chartOfAccounts.code, credit: calculated.net, description: "GST payment to IRC" },
        ],
      }, tx);
    });
    return NextResponse.json({ ok: true, result });
  } catch(e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "GST payment submission failed" }, { status: 400 }); }
}
