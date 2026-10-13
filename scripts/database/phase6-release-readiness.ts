import { prisma, databaseRuntimeInfo } from "../../src/lib/prisma";

async function main() {
  const info = databaseRuntimeInfo();
  const pending = await prisma.approvalRequest.findMany({
    where: { type: "ERP_CONVERSION_IDEMPOTENCY", status: { in: ["PENDING", "IN_REVIEW"] } },
    select: { code: true, documentType: true, documentCode: true, status: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });
  const report = {
    databaseProvider: info.provider,
    productionLike: info.productionLike,
    openClaims: pending.length,
    truncated: pending.length === 1000,
    claims: pending.map(row => ({
      claim: row.code.slice(0, 19) + "…",
      type: row.documentType, source: row.documentCode,
      status: row.status, since: row.createdAt.toISOString(), lastUpdated: row.updatedAt.toISOString(),
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (pending.length) {
    console.error("RELEASE GATE BLOCKED: unresolved conversion claims require reconciliation.");
    process.exitCode = 2;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
