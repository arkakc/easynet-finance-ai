import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Runs ONLY against a separately provisioned, disposable PostgreSQL DATABASE.
 * This script intentionally does NOT run db push, migrations or create databases.
 * All connection settings must reference an isolated QA database.
 */
async function main() {
  if (process.env.EASYNET_RUN_PG_INTEGRATION !== "isolated") throw new Error("Explicit isolated opt-in required");
  if (process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("Production execution refused");
  const raw = process.env.EASYNET_PHASE6_POSTGRES_TEST_URL;
  if (!raw) throw new Error("EASYNET_PHASE6_POSTGRES_TEST_URL required (disposable DB only)");
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^easynet_phase6_test_[a-z0-9_]+$/i.test(databaseName)) throw new Error("Test DB name must start easynet_phase6_test_");
  if (/^(public|prod|production)$/i.test(url.searchParams.get("schema") || "")) throw new Error("Production/public schema refused");
  const require = createRequire(import.meta.url);
  const generated = require(path.resolve(process.cwd(), "prisma/generated/postgresql-client/index.js"));
  const Client = generated.PrismaClient;
  if (typeof Client !== "function") throw new Error("Generate PostgreSQL Prisma client first");
  const a = new Client({ datasources: { db: { url: raw } } });
  const b = new Client({ datasources: { db: { url: raw } } });
  const { conversionClaimCode, executeWithConversionClaim } = await import("../../lib/erp/conversion-guard");
  const kind = "phase6-postgres-qa";
  const source = "qa-" + process.pid + "-" + Date.now();
  const code = conversionClaimCode(kind, source);
  try {
    // Schema must already be deployed in the isolated QA database.
    await a.$connect(); await b.$connect();
    let calls = 0;
    const adapter = (db: any) => ({
      create: (args: any) => db.approvalRequest.create(args),
      update: (args: any) => db.approvalRequest.update(args),
    });
    const run = (db: any) => executeWithConversionClaim(adapter(db), kind, source, async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 60));
      return "ok";
    });
    const results = await Promise.allSettled([run(a), run(b)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1, JSON.stringify(results));
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(calls, 1);
    assert.equal((await a.approvalRequest.findUniqueOrThrow({ where: { code } })).status, "APPROVED");
    const failureSource = source + "-partial";
    const failureCode = conversionClaimCode(kind, failureSource);
    await assert.rejects(executeWithConversionClaim(adapter(a), kind, failureSource, async () => {
      throw new Error("simulated external partial write");
    }), /simulated external partial write/);
    assert.equal((await b.approvalRequest.findUniqueOrThrow({ where: { code: failureCode } })).status, "IN_REVIEW");
    await assert.rejects(executeWithConversionClaim(adapter(b), kind, failureSource, async () => "duplicate"), /already in progress or completed/);
    console.log("PASS: isolated PostgreSQL cross-client contention and recovery checks");
  } finally {
    // Cleanup only rows created by THIS run inside the deliberately named disposable QA database.
    await Promise.allSettled([
      a.approvalRequest.deleteMany({ where: { code: { in: [code, conversionClaimCode(kind, source + "-partial")] }, type: "ERP_CONVERSION_IDEMPOTENCY" } }),
    ]);
    await Promise.allSettled([a.$disconnect(), b.$disconnect()]);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
