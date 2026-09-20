import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

async function sourceFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await sourceFiles(target));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(target);
    }
  }
  return results;
}

async function assertNoHiddenCoreRouter() {
  const allowedBackendConfigStatus = new Set([
    path.normalize("lib/backend/apps-script.ts"),
    path.normalize("app/api/health/backend-split/route.ts"),
    path.normalize("app/api/erp/actions/route.ts"),
  ]);
  const files = [
    ...await sourceFiles(path.join(process.cwd(), "app")),
    ...await sourceFiles(path.join(process.cwd(), "lib")),
  ];

  const violations: string[] = [];
  for (const file of files) {
    const relative = path.normalize(path.relative(process.cwd(), file));
    const source = await fs.readFile(file, "utf8");
    if (relative !== path.normalize("lib/backend/apps-script.ts") && /\bcallBackend\s*\(/.test(source)) {
      violations.push(`${relative}: direct callBackend() use`);
    }
    if (source.includes("backendConfigStatus") && !allowedBackendConfigStatus.has(relative)) {
      violations.push(`${relative}: backendConfigStatus may select a second core data path`);
    }
  }
  if (violations.length) {
    throw new Error(`Single-source architecture violations:\n${violations.join("\n")}`);
  }
  return files.length;
}

async function main() {
  const scannedSourceFiles = await assertNoHiddenCoreRouter();
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-single-source-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);

  // Deliberately configure a fake Core Apps Script endpoint. The UAT proves
  // that core reads/writes still stay inside the Prisma database and that
  // direct remote-core access is rejected before any network request.
  process.env.DATABASE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;
  process.env.CORE_APPS_SCRIPT_WEB_APP_URL = "https://core-accounting.invalid.example/exec";
  process.env.CORE_APPS_SCRIPT_API_TOKEN = "phase2-core-apps-script-must-be-ignored-0001";
  delete process.env.APPS_SCRIPT_WEB_APP_URL;
  delete process.env.APPS_SCRIPT_API_TOKEN;
  delete process.env.REPORTING_APPS_SCRIPT_WEB_APP_URL;
  delete process.env.REPORTING_APPS_SCRIPT_API_TOKEN;
  delete process.env.DOCUMENT_APPS_SCRIPT_WEB_APP_URL;
  delete process.env.DOCUMENT_APPS_SCRIPT_API_TOKEN;

  const backend = await import("../lib/backend/apps-script");
  const prismaModule = await import("../src/lib/prisma");
  const prisma = prismaModule.prisma;

  try {
    const configuration = backend.backendConfigStatus();
    if (configuration.core.authority !== "prisma") {
      throw new Error(`Core authority is ${configuration.core.authority}; expected prisma`);
    }
    if (configuration.core.externalSource !== "split" || !configuration.core.externalConfigured || !configuration.core.externalIgnored) {
      throw new Error("Configured Core Apps Script endpoint was not explicitly marked as ignored");
    }
    if (backend.isBackendConfigured("core")) {
      throw new Error("Core Apps Script must never be considered an active data backend");
    }

    const customerId = `UAT-SSOT-CUST-${process.pid}`;
    const created = await backend.appendRecord<any>(
      "Customers",
      {
        customerId,
        customerCode: customerId,
        customerName: "UAT Single Source Customer",
        active: true,
      },
      "single-source-uat",
    );
    if (created.authority !== "prisma" || created.service !== "core") {
      throw new Error("Core customer write did not report Prisma authority");
    }

    const found = await backend.findRecords<any>("Customers", { customerId }, 1);
    if (found.authority !== "prisma" || found.rows[0]?.customerId !== customerId) {
      throw new Error("Core customer read did not return the Prisma-written record");
    }

    await backend.updateRecord<any>(
      "Customers",
      "customerId",
      customerId,
      { customerName: "UAT Single Source Customer Updated" },
      "single-source-uat",
    );
    const updated = await backend.findRecords<any>("Customers", { customerId }, 1);
    if (updated.rows[0]?.customerName !== "UAT Single Source Customer Updated") {
      throw new Error("Core update was not persisted in Prisma");
    }

    const accountsResult = await backend.listTable<any>("Accounts", 500, 0);
    const parentIds = new Set(
      accountsResult.rows.map((row: any) => String(row.parentAccount || "")).filter(Boolean),
    );
    const leaves = accountsResult.rows.filter(
      (row: any) => row.active !== false && !parentIds.has(String(row.accountId || "")),
    );
    if (leaves.length < 2) throw new Error("UAT requires at least two active leaf GL accounts");

    const journalId = `UAT-SSOT-JRN-${process.pid}`;
    const sourceId = `UAT-SSOT-SOURCE-${process.pid}`;
    const posted = await backend.postJournalRecord({
      header: {
        journalId,
        postingDate: "2099-01-01",
        documentType: "JOURNAL_ENTRY",
        documentId: sourceId,
        documentNumber: journalId,
        reference: "Phase 2 single-source UAT",
        createdBy: "single-source-uat",
        approvedBy: "single-source-uat",
      },
      lines: [
        {
          journalLineId: `${journalId}-001`,
          journalId,
          lineNo: 1,
          accountId: leaves[0].accountId,
          debit: 12.34,
          credit: 0,
          description: "Single-source UAT debit",
        },
        {
          journalLineId: `${journalId}-002`,
          journalId,
          lineNo: 2,
          accountId: leaves[1].accountId,
          debit: 0,
          credit: 12.34,
          description: "Single-source UAT credit",
        },
      ],
      actor: "single-source-uat",
    });
    if (posted.authority !== "prisma" || posted.journalId !== journalId) {
      throw new Error("Journal posting did not use Prisma authority");
    }

    const journal = await backend.findRecords<any>("JournalHeaders", { journalId }, 1);
    if (journal.rows[0]?.journalId !== journalId || String(journal.rows[0]?.status || "").toUpperCase() !== "POSTED") {
      throw new Error("Posted journal was not readable from the same Prisma source");
    }

    let directRemoteCoreBlocked = false;
    try {
      await backend.callBackend("list", { table: "Customers", limit: 1 }, "core");
    } catch (error) {
      directRemoteCoreBlocked = /Prisma is the single source of truth/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!directRemoteCoreBlocked) {
      throw new Error("Direct Core Apps Script access was not blocked");
    }

    const persistedCustomer = await prisma.customer.findFirst({
      where: { OR: [{ id: customerId }, { code: customerId }] },
      select: { id: true, code: true, name: true },
    });
    const persistedJournal = await prisma.journalHeader.findUnique({
      where: { code: journalId },
      select: { code: true, status: true, totalDebit: true, totalCredit: true },
    });

    if (!persistedCustomer || persistedCustomer.name !== "UAT Single Source Customer Updated") {
      throw new Error("Customer wrapper result and Prisma database diverged");
    }
    if (
      !persistedJournal
      || persistedJournal.status !== "POSTED"
      || Number(persistedJournal.totalDebit) !== 12.34
      || Number(persistedJournal.totalCredit) !== 12.34
    ) {
      throw new Error("Journal wrapper result and Prisma database diverged");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      coreAuthority: configuration.core.authority,
      retiredCoreAppsScriptDetected: configuration.core.externalConfigured,
      retiredCoreAppsScriptIgnored: configuration.core.externalIgnored,
      customerReadWriteSameSource: true,
      journalReadWriteSameSource: true,
      directRemoteCoreBlocked,
      reportingIntegrationOptional: configuration.reporting.authority,
      documentIntegrationOptional: configuration.document.authority,
      scannedSourceFiles,
      hiddenCoreRouters: 0,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
      throw new Error("Unsafe UAT cleanup path");
    }
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
