import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { conversionClaimCode, executeWithConversionClaim } from "../../lib/erp/conversion-guard";

/**
 * Isolated real-SQLite integration harness. This test NEVER accepts a caller
 * supplied datasource URL. It constructs its own disposable database.
 */
async function main() {
  if (process.env.EASYNET_RUN_DB_INTEGRATION !== "isolated") {
    throw new Error("Explicitly set EASYNET_RUN_DB_INTEGRATION=isolated to run disposable database checks.");
  }
  if (process.env.DATABASE_PROVIDER === "postgresql" || process.env.APP_ENV === "production") {
    throw new Error("Refusing database integration harness in production/PostgreSQL context");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "easynet-phase6-"));
  const databasePath = path.join(directory, "test.sqlite").replace(/\\/g, "/");
  const datasourceUrl = "file:" + databasePath;
  const prismaCommand = path.resolve(process.cwd(), "node_modules/prisma/build/index.js");
  const disposableSchema = path.join(directory, "schema.prisma");
  let client: PrismaClient | undefined;
  try {
    const originalSchema = await readFile(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const patchedSchema = originalSchema.replace(/(datasource\s+db\s*\{[\s\S]*?url\s*=\s*)("[^"]*"|env\("[^"]+"\))/m,
      (_match, prefix: string) => prefix + JSON.stringify(datasourceUrl));
    if (patchedSchema === originalSchema) throw new Error("Cannot locate Prisma datasource; refusing to touch a non-isolated database");
    if (!patchedSchema.includes(JSON.stringify(datasourceUrl))) throw new Error("Disposable datasource was not applied");
    await writeFile(disposableSchema, patchedSchema, "utf8");
    const setup = spawnSync(process.execPath, [prismaCommand, "db", "push", "--schema", disposableSchema, "--skip-generate"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PROVIDER: "sqlite", DATABASE_URL: datasourceUrl, EASYNET_PRISMA_DATASOURCE_URL: datasourceUrl },
      encoding: "utf8",
      timeout: 120000,
    });
    if (setup.status !== 0) throw new Error("Disposable schema setup failed: " + (setup.stderr || setup.stdout));
    client = new PrismaClient({ datasourceUrl });
    const db = client;
    const store = {
      create: (args: Parameters<typeof db.approvalRequest.create>[0]) => db.approvalRequest.create(args),
      update: (args: Parameters<typeof db.approvalRequest.update>[0]) => db.approvalRequest.update(args),
    };
    const sourceId = "ISOLATED-PO-1";
    let writes = 0;
    const run = () => executeWithConversionClaim(store as never, "purchaseOrderToBill", sourceId, async () => {
      writes++;
      await new Promise(resolve => setTimeout(resolve, 30));
      return "created";
    });
    const results = await Promise.allSettled([run(), run()]);
    const failures = results.filter(row => row.status === "rejected").map(row => row.reason instanceof Error ? row.reason.message : String(row.reason));
    assert.equal(results.filter(row => row.status === "fulfilled").length, 1, `Expected exactly one successful real database claim: ${failures.join(" | ")}`);
    assert.equal(results.filter(row => row.status === "rejected").length, 1);
    assert.equal(writes, 1);
    assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { code: conversionClaimCode("purchaseOrderToBill", sourceId) } })).status, "APPROVED");

    const failureId = "ISOLATED-SQ-2";
    await assert.rejects(executeWithConversionClaim(store, "quoteToInvoice", failureId, async () => {
      // Simulates downstream failure after the first external write.
      throw new Error("simulated partial external write");
    }), /simulated partial/);
    assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { code: conversionClaimCode("quoteToInvoice", failureId) } })).status, "IN_REVIEW");
    await assert.rejects(executeWithConversionClaim(store, "quoteToInvoice", failureId, async () => "duplicate"), /already in progress or completed/);
    console.log("PASS: isolated real SQLite contention and failure-recovery claim checks");
  } finally {
    if (client) await client.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
