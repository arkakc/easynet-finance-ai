import { prisma } from "../../src/lib/prisma";
import { outstandingPurchaseCommitments } from "../../lib/accounting/purchase-commitments";

const n = (value: unknown) => Number(value || 0);
const r2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

async function main() {
  const [orders, receipts, bills, journals, banks] = await Promise.all([
    prisma.purchaseOrder.findMany({ include: { lines: { include: { item: { select: { type: true } } } } } }),
    prisma.stockMovement.findMany({ where: { type: "PURCHASE_RECEIPT" }, select: { referenceId: true, itemId: true, quantity: true, journalId: true } }),
    prisma.supplierBill.findMany({ where: { glPosted: true }, include: { lines: { select: { itemId: true, quantity: true } } } }),
    prisma.journalHeader.findMany({ where: { status: "POSTED", sourceDocType: { in: ["PURCHASE_RECEIPT", "SUPPLIER_BILL"] } }, include: { lines: { include: { account: { select: { code: true, name: true } } } } } }),
    prisma.bankAccount.findMany({ where: { isActive: true }, include: { chartOfAccounts: { select: { code: true, name: true } }, reconciliations: { where: { status: "COMPLETED" }, orderBy: { periodEnd: "desc" }, take: 1 }, transactions: { select: { id: true, matchStatus: true, isReconciled: true } } } }),
  ]);
  const total = outstandingPurchaseCommitments(orders, receipts, bills);
  console.log(`PO remaining unfulfilled commitment (base currency): K${total.toFixed(2)}`);
  const sourceJournals = new Map(journals.map((journal) => [journal.id, journal]));
  const journalByCode = new Map(journals.map((journal) => [journal.code, journal]));
  let exceptionCount = 0;
  for (const order of orders) {
    const receiptJournals = [...new Set(receipts.filter((m) => m.referenceId === order.id || m.referenceId === order.code).map((m) => m.journalId).filter((id): id is string => Boolean(id)))];
    const orderBills = bills.filter((bill) => bill.orderId === order.id || bill.poReference === order.id || bill.poReference === order.code);
    if (!receiptJournals.length && !orderBills.length) continue;
    const credits = new Map<string, number>();
    const debits = new Map<string, number>();
    for (const ref of receiptJournals) {
      const journal = sourceJournals.get(ref) || journalByCode.get(ref);
      if (!journal) { console.log(`FAIL ${order.code}: receipt GL journal ${ref} not found or not posted`); exceptionCount++; continue; }
      for (const line of journal.lines) if (n(line.credit) > 0) credits.set(line.accountId, (credits.get(line.accountId) || 0) + n(line.credit));
    }
    for (const bill of orderBills) {
      const journal = bill.journalId ? sourceJournals.get(bill.journalId) || journalByCode.get(bill.journalId) : null;
      if (!journal) { console.log(`FAIL ${order.code}: posted bill ${bill.code} missing posted journal`); exceptionCount++; continue; }
      for (const line of journal.lines) if (n(line.debit) > 0) debits.set(line.accountId, (debits.get(line.accountId) || 0) + n(line.debit));
    }
    const clearingAccountIds = [...credits.keys()].filter((id) => debits.has(id));
    if (!clearingAccountIds.length && receiptJournals.length && orderBills.length) {
      console.log(`FAIL ${order.code}: no common receipt-credit / bill-debit GRNI account found`); exceptionCount++; continue;
    }
    for (const id of clearingAccountIds) {
      const delta = r2((credits.get(id) || 0) - (debits.get(id) || 0));
      const journalLine = journals.flatMap((j) => j.lines).find((line) => line.accountId === id);
      console.log(`${Math.abs(delta) < .01 ? "PASS" : "REVIEW"} ${order.code} GRNI GL ${journalLine?.account.code || id}: receipts Cr K${r2(credits.get(id) || 0).toFixed(2)}, supplier bills Dr K${r2(debits.get(id) || 0).toFixed(2)}, outstanding K${delta.toFixed(2)}`);
      // An outstanding GRNI balance can be legitimate for receipts not yet invoiced.
      if (delta < -.01) { console.log(`FAIL ${order.code}: GRNI over-cleared beyond received value`); exceptionCount++; }
    }
  }
  console.log("External bank statement reconciliation (requires actual bank-provided evidence):");
  if (!banks.length) console.log("PENDING: no active bank accounts");
  for (const bank of banks) {
    const latest = bank.reconciliations[0];
    const remaining = bank.transactions.filter((t) => !t.isReconciled).length;
    console.log(`${latest && remaining === 0 ? "CHECK PERIOD" : "PENDING"} ${bank.code} GL ${bank.chartOfAccounts?.code || "UNMAPPED"}; statement rows ${bank.transactions.length}; unreconciled ${remaining}; last completed ${latest?.periodEnd.toISOString().slice(0,10) || "NONE"}`);
    if (!latest || remaining > 0) console.log("  Import external CSV/Excel statement in Banking → Reconciliation, match entries, then reconcile selected period.");
  }
  console.log(`GRNI structural exceptions: ${exceptionCount}. External reconciliation is never certified without bank statement evidence.`);
  if (exceptionCount) process.exitCode = 2;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
