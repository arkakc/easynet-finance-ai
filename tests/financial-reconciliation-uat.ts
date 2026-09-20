import { buildFinancialReconciliationSnapshot } from "../lib/system/financial-reconciliation";
import { prisma } from "../src/lib/prisma";

async function main() {
  const snapshot = await buildFinancialReconciliationSnapshot({ asOf: "2026-09-13", generatedBy: "uat" });
  if (snapshot.ledger.totalDebit !== snapshot.ledger.totalCredit) throw new Error("Financial snapshot ledger is not balanced");
  if (snapshot.receivables.difference !== 0 || snapshot.payables.difference !== 0) throw new Error(`Unexpected AR/AP differences: ${snapshot.receivables.difference}/${snapshot.payables.difference}`);
  if (!snapshot.controls.migrationReady) throw new Error(`Fresh sandbox migration baseline is not ready: ${snapshot.controls.exceptions.join("; ")}`);
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, ledgerBalanced: snapshot.ledger.totalDebit === snapshot.ledger.totalCredit, migrationReady: snapshot.controls.migrationReady, receivables: { glBalance: snapshot.receivables.glBalance, subledger: snapshot.receivables.outstanding, difference: snapshot.receivables.difference }, payables: { glBalance: snapshot.payables.glBalance, subledger: snapshot.payables.outstanding, difference: snapshot.payables.difference }, exceptions: snapshot.controls.exceptions }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
