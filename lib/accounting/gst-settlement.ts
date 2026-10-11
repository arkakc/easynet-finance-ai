import type { Prisma } from "@prisma/client";
export const GST_SETTLEMENT_PREFIX = "GST-SETTLEMENT:";
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function gstSettlementBalances(tx: Prisma.TransactionClient, paymentDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("Payment date must be YYYY-MM-DD");
  const end = new Date(paymentDate + "T23:59:59.999+10:00");
  if (Number.isNaN(end.getTime())) throw new Error("Invalid payment date");
  const get = async (code: string) => {
    const account = await tx.chartOfAccounts.findUnique({ where: { code }, include: { children: { select: { id: true } } } });
    if (!account || !account.isActive || account.children.length) throw new Error("Invalid GST posting ledger: " + code);
    const lines = await tx.journalLine.findMany({
      where: { accountId: account.id, journal: { status: "POSTED", date: { lte: end } } },
      select: { debit: true, credit: true },
    });
    return { id: account.id, debit: round(lines.reduce((s,l) => s + Number(l.debit),0)), credit: round(lines.reduce((s,l) => s + Number(l.credit),0)) };
  };
  const output = await get("2120");
  const input = await get("1140");
  const outputDue = round(output.credit-output.debit);
  const inputCredit = round(input.debit-input.credit);
  const net = round(outputDue-inputCredit);
  if (outputDue < 0 || inputCredit < 0 || net < 0) throw new Error("GST control balances require finance review");
  return { output, input, outputDue, inputCredit, net };
}
