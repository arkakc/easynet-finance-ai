import { prisma } from "../../src/lib/prisma";
import { postJournalInTransaction } from "../../lib/accounting/atomic-posting";
import { sourceControlAccount } from "../../lib/accounting/settlement-control-account";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirm = args.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const date = new Date().toISOString().slice(0, 10);

type Proposed = {
  paymentId: string; paymentCode: string; invoiceCode: string; partyId: string; side: "AR" | "AP";
  sourceCode: string; settledCode: string; sourceId: string; settledId: string; amount: number;
};

async function scan(): Promise<Proposed[]> {
  const payments = await prisma.payment.findMany({
    where: { status: "CLEARED", journalId: { not: null }, OR: [{ customerId: { not: null } }, { supplierId: { not: null } }] },
    include: { allocations: { where: { status: "POSTED", reversalDate: null } } },
    orderBy: { code: "asc" },
  });
  const proposed: Proposed[] = [];
  for (const payment of payments) {
    if (!payment.allocations.length) continue;
    if (payment.allocations.length !== 1) throw new Error(`Payment ${payment.code} has multiple allocations; manual review required`);
    const allocation = payment.allocations[0];
    if (!allocation.journalId) throw new Error(`Allocation ${allocation.code} has no posted settlement journal; manual review required`);
    const alreadyCorrected = await prisma.journalHeader.findUnique({ where: { sourceDocId: `CONTROL-RECLASS:${payment.id}` } });
    if (alreadyCorrected) {
      if (alreadyCorrected.status !== "POSTED") throw new Error(`Prior correction is not POSTED: ${payment.code}`);
      continue;
    }
    const side = allocation.invoiceId ? "AR" : allocation.billId ? "AP" : null;
    if (!side || (side === "AR" ? !payment.customerId : !payment.supplierId)) throw new Error(`Invalid allocation party for ${payment.code}`);
    if (payment.currency !== "PGK" || allocation.currency !== "PGK") throw new Error(`Non-PGK settlement ${payment.code} requires FX audit`);
    const document = side === "AR"
      ? await prisma.invoice.findUnique({ where: { id: allocation.invoiceId! }, select: { code: true, journalId: true, customerId: true, currency: true, glPosted: true } })
      : await prisma.supplierBill.findUnique({ where: { id: allocation.billId! }, select: { code: true, journalId: true, supplierId: true, currency: true, glPosted: true } });
    if (!document?.journalId || !document.glPosted || document.currency !== "PGK") throw new Error(`Source document for ${payment.code} is not valid posted PGK invoice/bill`);
    if ((side === "AR" ? (document as any).customerId !== payment.customerId : (document as any).supplierId !== payment.supplierId)) throw new Error(`Party mismatch for ${payment.code}`);
    const journals = await prisma.journalHeader.findMany({
      where: { OR: [{ id: document.journalId }, { code: document.journalId }, { id: allocation.journalId }, { code: allocation.journalId }] },
      include: { lines: { include: { account: { select: { code: true, type: true } } } } },
    });
    const original = journals.find((j) => j.id === document.journalId || j.code === document.journalId);
    const settlement = journals.find((j) => j.id === allocation.journalId || j.code === allocation.journalId);
    if (!original || !settlement || original.status !== "POSTED" || settlement.status !== "POSTED") throw new Error(`Missing posted source/settlement journal for ${payment.code}`);
    const originalId = sourceControlAccount(original.lines, side === "AR" ? "RECEIVABLE" : "PAYABLE");
    const settlementLines = settlement.lines.filter((line) => side === "AR"
      ? Number(line.credit) > 0 && /^settle accounts receivable(?: from advance)?$/i.test(line.description.trim())
      : Number(line.debit) > 0 && /^settle accounts payable(?: from advance)?$/i.test(line.description.trim()));
    if (settlementLines.length !== 1) throw new Error(`Ambiguous settlement journal for ${payment.code}`);
    const settlementLine = settlementLines[0];
    const settlementAmount = round(side === "AR" ? Number(settlementLine.credit) : Number(settlementLine.debit));
    if (settlementLine.account.type !== (side === "AR" ? "ASSET" : "LIABILITY")) throw new Error(`Unexpected settlement account type for ${payment.code}`);
    if (settlementAmount <= 0 || Math.abs(settlementAmount - Number(allocation.baseAmount || allocation.amount)) > 0.01) {
      throw new Error(`Allocation GL amount mismatch for ${payment.code}`);
    }
    if (originalId === settlementLine.account.code) continue;
    const sourceAccount = original.lines.find((line) => line.account.code === originalId)?.account;
    if (!sourceAccount || sourceAccount.type !== (side === "AR" ? "ASSET" : "LIABILITY")) throw new Error(`Original control account has invalid type for ${payment.code}`);
    proposed.push({
      paymentId: payment.id, paymentCode: payment.code, invoiceCode: document.code, side,
      partyId: String(side === "AR" ? payment.customerId : payment.supplierId),
      sourceId: originalId, sourceCode: sourceAccount.code,
      settledId: settlementLine.account.code, settledCode: settlementLine.account.code, amount: settlementAmount,
    });
  }
  return proposed;
}

async function main() {
  const proposed = await scan();
  for (const p of proposed) {
    console.log(`${p.side} ${p.paymentCode} -> ${p.invoiceCode}: ${p.amount.toFixed(2)} PGK; settlement account ${p.settledCode} -> original document account ${p.sourceCode}`);
  }
  const ar = round(proposed.filter((p) => p.side === "AR").reduce((s, p) => s + p.amount, 0));
  const ap = round(proposed.filter((p) => p.side === "AP").reduce((s, p) => s + p.amount, 0));
  console.log(`Preview: ${proposed.length} reclass journal(s); AR ${ar.toFixed(2)} PGK; AP ${ap.toFixed(2)} PGK.`);
  if (!apply) { console.log("READ-ONLY. No database changes. Backup and review before applying."); return; }
  if (confirm !== `${ar.toFixed(2)}:${ap.toFixed(2)}`) {
    throw new Error(`Apply requires --confirm=${ar.toFixed(2)}:${ap.toFixed(2)} (amounts must match audited preview)`);
  }
  if (proposed.length === 0) { console.log("No correction needed."); return; }
  for (const p of proposed) {
    const docId = `CONTROL-RECLASS:${p.paymentId}`;
    const posted = await prisma.$transaction(async (tx) => {
      const existing = await tx.journalHeader.findUnique({ where: { sourceDocId: docId } });
      if (existing) { console.log(`Already corrected: ${p.paymentCode} ${existing.code}`); return null; }
      return postJournalInTransaction(tx, {
        postingDate: date, documentType: "CONTROL_ACCOUNT_RECLASS", documentId: docId,
        documentNumber: p.paymentCode,
        reference: `AR/AP settlement account reclass for ${p.paymentCode} against ${p.invoiceCode}; no cash or tax impact`,
        createdBy: "historical-control-reconciliation", approvedBy: "Finance Controller",
        lines: p.side === "AR" ? [
          { accountId: p.settledCode, debit: p.amount, customerId: p.partyId, description: "Reverse incorrect receipt control credit" },
          { accountId: p.sourceCode, credit: p.amount, customerId: p.partyId, description: "Settle source invoice control account" },
        ] : [
          { accountId: p.sourceCode, debit: p.amount, supplierId: p.partyId, description: "Settle source bill control account" },
          { accountId: p.settledCode, credit: p.amount, supplierId: p.partyId, description: "Reverse incorrect payment control debit" },
        ],
      });
    });
    if (posted) console.log(`POSTED correction ${posted.journalId} for ${p.paymentCode}`);
  }
  console.log("Done. Run npm run db:reconcile:snapshot and investigate any remaining exceptions.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
