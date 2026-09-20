import { prisma } from "../../src/lib/prisma";

const EXPECTED_MAPPINGS: Record<string, string> = {
  "BANK-BSP": "1121",
  "BANK-KINA": "1122",
  "BANK-WPNG": "1123",
  "BANK-USD": "1124",
  "CASH-POM": "1111",
};

const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm=MAP_BANKS");

async function main() {
  const [banks, ledgerAccounts, auditUser] = await Promise.all([
    prisma.bankAccount.findMany({ where: { code: { in: Object.keys(EXPECTED_MAPPINGS) } }, orderBy: { code: "asc" } }),
    prisma.chartOfAccounts.findMany({
      where: { code: { in: Object.values(EXPECTED_MAPPINGS) }, type: "ASSET", isActive: true },
      include: { _count: { select: { children: true } } },
    }),
    prisma.user.findFirst({ where: { status: "ACTIVE", role: "SYSTEM_MANAGER" }, orderBy: { createdAt: "asc" } }),
  ]);
  const bankByCode = new Map(banks.map((row) => [row.code, row]));
  const ledgerByCode = new Map(ledgerAccounts.map((row) => [row.code, row]));
  const changes = Object.entries(EXPECTED_MAPPINGS).map(([bankCode, ledgerCode]) => {
    const bank = bankByCode.get(bankCode);
    const ledger = ledgerByCode.get(ledgerCode);
    if (!bank) throw new Error(`Required bank account ${bankCode} is missing`);
    if (!ledger) throw new Error(`Required active asset GL account ${ledgerCode} is missing`);
    if (ledger._count.children) throw new Error(`GL account ${ledgerCode} is not a leaf account`);
    return { bank, ledger, requiresUpdate: bank.chartOfAccountsId === null };
  });

  for (const row of changes) {
    const state = row.requiresUpdate ? "MAP" : row.bank.chartOfAccountsId === row.ledger.id ? "ALREADY CORRECT" : "KEEP EXISTING";
    console.log(`${state}: ${row.bank.code} -> ${row.ledger.code} (${row.ledger.name})`);
  }
  if (!apply) {
    console.log("Dry run only. Apply with --apply --confirm=MAP_BANKS.");
    return;
  }
  if (!confirmed) throw new Error("Applying mappings requires --confirm=MAP_BANKS");
  if (!auditUser) throw new Error("An active System Manager is required for the audit trail");

  const pending = changes.filter((row) => row.requiresUpdate);
  await prisma.$transaction(async (tx) => {
    for (const row of pending) {
      await tx.bankAccount.update({
        where: { id: row.bank.id, chartOfAccountsId: null },
        data: { chartOfAccountsId: row.ledger.id },
      });
      await tx.auditLog.create({ data: {
        action: "CONFIGURE",
        entityType: "BankAccount",
        entityId: row.bank.id,
        entityCode: row.bank.code,
        description: `Backfilled bank ledger mapping to ${row.ledger.code} — ${row.ledger.name}`,
        changes: JSON.stringify({ chartOfAccountsId: { before: null, after: row.ledger.id }, ledgerCode: row.ledger.code }),
        userId: auditUser.id,
      } });
    }
  });
  console.log(`Applied ${pending.length} missing bank ledger mapping(s). Existing mappings were not overwritten.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
