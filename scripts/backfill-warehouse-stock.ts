import { backfillWarehouseStock } from "../lib/accounting/warehouse-stock-migration";
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillWarehouseStock({ apply });
  console.log(JSON.stringify(result, null, 2));
  if (result.mode === "PREVIEW" && result.unassignedMovements > 0) {
    console.log("\nPreview only. Re-run with --apply after reviewing the migration plan.");
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
