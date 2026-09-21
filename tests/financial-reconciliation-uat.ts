import { buildFinancialReconciliationSnapshot } from "../lib/system/financial-reconciliation";
import { prisma } from "../src/lib/prisma";

async function main() {
  const snapshot = await buildFinancialReconciliationSnapshot({ asOf: "2026-09-13", generatedBy: "uat" });

  if (snapshot.ledger.totalDebit !== snapshot.ledger.totalCredit) {
    throw new Error("Financial snapshot ledger is not balanced");
  }

  // The seeded sandbox deliberately contains posted legacy AR/AP journals
  // without subledger rows. Before recovery, reconciliation must detect and
  // block those differences rather than incorrectly reporting migration-ready.
  if (snapshot.receivables.difference !== 67000 || snapshot.payables.difference !== 42500) {
    throw new Error(
      `Unexpected legacy AR/AP detection: ${snapshot.receivables.difference}/${snapshot.payables.difference}`,
    );
  }
  if (snapshot.controls.migrationReady) {
    throw new Error("Unrecovered legacy AR/AP was incorrectly marked migration-ready");
  }

  const exceptionText = snapshot.controls.exceptions.join(" | ").toLowerCase();
  if (!exceptionText.includes("receivable") || !exceptionText.includes("payable")) {
    throw new Error(`AR/AP reconciliation exceptions were not surfaced: ${snapshot.controls.exceptions.join("; ")}`);
  }

  console.log(JSON.stringify({
    database: "live read-only",
    liveDatabaseChanged: false,
    ledgerBalanced: snapshot.ledger.totalDebit === snapshot.ledger.totalCredit,
    unrecoveredLegacyDetected: true,
    migrationBlockedBeforeRecovery: !snapshot.controls.migrationReady,
    receivables: {
      glBalance: snapshot.receivables.glBalance,
      subledger: snapshot.receivables.outstanding,
      difference: snapshot.receivables.difference,
    },
    payables: {
      glBalance: snapshot.payables.glBalance,
      subledger: snapshot.payables.outstanding,
      difference: snapshot.payables.difference,
    },
    exceptions: snapshot.controls.exceptions,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
