import { backfillMultiCurrency } from "../lib/accounting/multi-currency-migration";
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillMultiCurrency({ apply });
  console.log(JSON.stringify(result, null, 2));
  if (!apply) {
    console.log(
      result.blockers.length
        ? "\nPreview only. Resolve every blocker before running --apply."
        : "\nPreview only. Re-run with --apply after reviewing the backfill summary.",
    );
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
