import { backfillLegacyPaymentAllocations } from "../lib/accounting/payment-allocation-migration";
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillLegacyPaymentAllocations({ apply });
  console.log(JSON.stringify(result, null, 2));
  if (!apply && result.planned > 0) {
    console.log("\nPreview only. Re-run with --apply after reviewing the planned allocation rows.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
