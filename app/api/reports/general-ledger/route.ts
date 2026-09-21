import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const date = (value: string, end = false) => new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+10:00`);
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function GET(request: NextRequest) {
  try {
    await requirePermission("reports.read");
    const accountId = request.nextUrl.searchParams.get("accountId") || "";
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (!accountId) throw new Error("Select an account");
    const account = await prisma.chartOfAccounts.findUnique({ where: { id: accountId } });
    if (!account) throw new Error("Account not found");
    const openingLines = from ? await prisma.journalLine.findMany({ where: { accountId, journal: { status: "POSTED", date: { lt: date(from) } } }, select: { debit: true, credit: true } }) : [];
    const opening = round(openingLines.reduce((s,l)=>s+Number(l.debit)-Number(l.credit),0));
    const lines = await prisma.journalLine.findMany({
      where: { accountId, journal: { status: "POSTED", date: { ...(from ? { gte: date(from) } : {}), lte: date(to,true) } } },
      include: { journal: true },
      orderBy: [{ journal: { date: "asc" } }, { journal: { createdAt: "asc" } }, { lineNo: "asc" }],
    });
    let running = opening;
    const rows = lines.map(l => {
      const debit=Number(l.debit), credit=Number(l.credit); running=round(running+debit-credit);
      return { id:l.id, date:l.journal.date.toISOString().slice(0,10), journalId:l.journal.id, journalCode:l.journal.code, documentType:l.journal.sourceDocType, documentNo:l.journal.sourceDocId, reference:l.journal.reference || l.journal.description, description:l.description, debit, credit, balance:running };
    });
    return NextResponse.json({ ok:true, ledger:{ account:{id:account.id,code:account.code,name:account.name,type:account.type}, period:{from:from||null,to}, openingBalance:opening, rows, totals:{debit:round(rows.reduce((s,r)=>s+r.debit,0)),credit:round(rows.reduce((s,r)=>s+r.credit,0)),closingBalance:running} } });
  } catch(error) {
    const message=error instanceof Error?error.message:"General Ledger could not be loaded";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});
  }
}