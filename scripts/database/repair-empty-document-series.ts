import { prisma } from "../../src/lib/prisma";
import { existingVisibleSequenceMax } from "../../lib/accounting/document-numbering";

const apply = process.argv.includes("--apply");

async function main() {
  const counters = await prisma.globalSettings.findMany({
    where: { key: { startsWith: "document_series:" } },
    select: { key: true, valueInt: true },
    orderBy: { key: "asc" },
  });
  let candidates = 0;
  for (const counter of counters) {
    const match = /^document_series:([A-Z0-9]+):(\d{4})$/.exec(counter.key);
    if (!match) continue;
    const [, prefix, year] = match;
    const max = await existingVisibleSequenceMax(prefix, Number(year));
    if (max > 0 || Number(counter.valueInt || 0) <= 0) {
      console.log(`KEEP ${prefix}-${year}: stored=${counter.valueInt || 0}, persistedMax=${max}`);
      continue;
    }
    candidates++;
    console.log(`${apply ? "RESET" : "WOULD RESET"} ${prefix}-${year}: stale counter ${counter.valueInt} -> 0; no persisted documents`);
    if (apply) {
      const changed = await prisma.globalSettings.updateMany({
        where: { key: counter.key, valueInt: counter.valueInt },
        data: { valueInt: 0, updatedBy: "document-series-repair" },
      });
      if (changed.count !== 1) throw new Error(`Counter ${counter.key} changed concurrently; stop and rerun preview`);
    }
  }
  console.log(`${apply ? "Applied" : "Preview"}: ${candidates} empty-series stale counter(s). Existing document codes were not modified.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
