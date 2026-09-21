import { saveFinancialReconciliationSnapshot } from "../../lib/system/financial-reconciliation";
import { prisma } from "../../src/lib/prisma";

const asOfArgument = process.argv.slice(2).find((value) => value.startsWith("--as-of="))?.slice("--as-of=".length);

async function main() {
  const snapshot = await saveFinancialReconciliationSnapshot({
    asOf: asOfArgument,
    generatedBy: process.env.USERNAME || "local-operator",
  });
  console.log(`Financial reconciliation snapshot: ${snapshot.fileName}`);
  console.log(`Fingerprint: ${snapshot.fingerprint}`);
  console.log(`Ledger balanced: ${snapshot.controls.ledgerBalanced}`);
  console.log(`Migration ready: ${snapshot.controls.migrationReady}`);
  for (const exception of snapshot.controls.exceptions) console.log(`Control exception: ${exception}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
