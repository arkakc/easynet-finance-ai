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

/**
 * Monthly GST control calculation from dated POSTED tax ledger lines.
 * Excludes settlement movements and reversal entries of GST settlements.
 * This is a ledger-based period control, NOT an IRC-validated return.
 */
export async function gstPeriodBalances(tx: Prisma.TransactionClient, period: string, paymentDate: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("GST reporting period must be YYYY-MM");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("Invalid payment date");
  const [year, month] = period.split("-").map(Number);
  if (month < 1 || month > 12) throw new Error("Invalid GST month");
  const periodEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = new Date(`${period}-01T00:00:00+10:00`);
  const end = new Date(`${period}-${String(periodEnd).padStart(2,"0")}T23:59:59.999+10:00`);
  const paidBy = new Date(paymentDate+"T23:59:59.999+10:00");
  if (paidBy < end) throw new Error("GST period must end before payment date");
  const settledJournals = await tx.journalHeader.findMany({
    where: { sourceDocType: "GST_SETTLEMENT" }, select: { id: true },
  });
  const ids = settledJournals.map(j=>j.id);
  const balances = await Promise.all(["2120","1140"].map(async code=>{
    const account = await tx.chartOfAccounts.findUnique({where:{code},include:{children:{select:{id:true}}}});
    if (!account||!account.isActive||account.children.length) throw new Error("Invalid GST posting ledger: "+code);
    const lines = await tx.journalLine.findMany({
      where: {accountId:account.id,journal:{status:"POSTED",date:{gte:start,lte:end},
        AND: [
          { OR: [{sourceDocType:null},{sourceDocType:{not:"GST_SETTLEMENT"}}] },
          ...(ids.length ? [{ OR: [{reversalOfJournalId:null},{reversalOfJournalId:{notIn:ids}}] }] : []),
        ]}},
      select:{debit:true,credit:true},
    });
    return {id:account.id,debit:round(lines.reduce((s,l)=>s+Number(l.debit),0)),credit:round(lines.reduce((s,l)=>s+Number(l.credit),0))};
  }));
  const [output,input]=balances;
  const outputDue=round(output.credit-output.debit);
  const inputCredit=round(input.debit-input.credit);
  const net=round(outputDue-inputCredit);
  if(outputDue<0||inputCredit<0||net<0)throw new Error("Period has negative GST controls or credit balance: finance review required");
  return {output,input,outputDue,inputCredit,net,period};
}
