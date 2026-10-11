import { prisma } from "../../src/lib/prisma";

const asOf = process.argv.find(a => a.startsWith("--as-of="))?.slice(8) || "2026-10-11";
const end = new Date(asOf + "T23:59:59.999+10:00");

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(end.getTime())) throw new Error("Invalid as-of date");
  console.log("READ-ONLY GST JOURNAL DIAGNOSTIC through", asOf);
  const journals = await prisma.journalHeader.findMany({
    where: { status: "POSTED", date: { lte: end } },
    orderBy: [{ date: "asc" }, { code: "asc" }],
    include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNo: "asc" } } },
  });
  for (const journal of journals) {
    console.log("JOURNAL", journal.code, "DATE", journal.date.toISOString().slice(0,10),
      "TYPE", journal.sourceDocType || "(none)", "SOURCE", journal.sourceDocId || "(none)",
      "REFERENCE", journal.reference || "(none)", "REVERSES", journal.reversalOfJournalId || "(none)");
    for (const line of journal.lines) {
      console.log("  GL", line.account.code, line.account.name,
        "DR", Number(line.debit).toFixed(2), "CR", Number(line.credit).toFixed(2));
    }
  }
  const settlements = await prisma.gstSettlement.findMany({
    select: { code: true, period: true, status: true, journalId: true, reversalJournalId: true, netPayable: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("GST SETTLEMENT DOCUMENTS:", settlements.map(s => ({
    code: s.code, period: s.period, status: s.status,
    journalId: s.journalId, reversalJournalId: s.reversalJournalId, netPayable: Number(s.netPayable),
  })));
  const controlLines = journals.flatMap(j => j.lines
    .filter(l => ["2120","1140"].includes(l.account.code))
    .map(l => ({ journal: j.code, type: j.sourceDocType, account: l.account.code,
      debit: Number(l.debit), credit: Number(l.credit) })));
  console.log("GST CONTROL MOVEMENTS:", controlLines);
}
main().catch(e => { console.error(e); process.exitCode=1; }).finally(() => prisma.$disconnect());
