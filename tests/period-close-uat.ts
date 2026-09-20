import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { closeAccountingPeriod, monthBounds, reopenAccountingPeriod } from "../lib/accounting/period-close";
import { buildFinancialStatements } from "../lib/accounting/financial-statements";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";
import { prisma } from "../src/lib/prisma";

async function main() {
  await verifyLiveDatabase();
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-period-close-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });
  try {
    const month = "2026-08";
    const bounds = monthBounds(month);
    const actor = await client.user.findFirst({ where: { status: "ACTIVE", role: "SYSTEM_MANAGER" } });
    if (!actor) throw new Error("UAT requires an active System Manager");
    await client.accountingPeriod.deleteMany();
    await client.reconciliation.deleteMany({ where: { periodStart: { lte: bounds.end }, periodEnd: { gte: bounds.start } } });
    await client.globalSettings.upsert({
      where: { key: "posting_lock_date" },
      create: { key: "posting_lock_date", value: "2026-07-31" },
      update: { value: "2026-07-31" },
    });
    const banks = await client.bankAccount.findMany({ where: { isActive: true } });
    for (const bank of banks) {
      await client.reconciliation.create({ data: {
        bankAccountId: bank.id,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        statementBalance: 0,
        bookBalance: 0,
        difference: 0,
        status: "COMPLETED",
        preparedBy: "period-close-uat",
        reviewedBy: "period-close-uat",
        reviewedAt: new Date(),
      } });
    }

    const baseline = await buildFinancialStatements({ from: "1900-01-01", asOf: bounds.endText }, client);
    const customer = await client.customer.findFirst({ where: { isActive: true } });
    const supplier = await client.supplier.findFirst({ where: { isActive: true } });
    if (!customer || !supplier) throw new Error("UAT requires an active customer and supplier");
    if (baseline.controls.receivables.difference > 0) {
      await client.invoice.create({ data: {
        code: "UAT-AR-CONTROL",
        customerId: customer.id,
        issuedDate: bounds.start,
        dueDate: bounds.end,
        status: "SENT",
        subtotal: baseline.controls.receivables.difference,
        total: baseline.controls.receivables.difference,
        outstanding: baseline.controls.receivables.difference,
        journalId: "UAT-AR-JOURNAL",
        glPosted: true,
        createdBy: actor.email,
      } });
    }
    if (baseline.controls.payables.difference > 0) {
      await client.supplierBill.create({ data: {
        code: "UAT-AP-CONTROL",
        supplierId: supplier.id,
        billDate: bounds.start,
        dueDate: bounds.end,
        status: "SENT",
        subtotal: baseline.controls.payables.difference,
        total: baseline.controls.payables.difference,
        outstanding: baseline.controls.payables.difference,
        journalId: "UAT-AP-JOURNAL",
        glPosted: true,
        createdBy: actor.email,
      } });
    }

    const closed = await closeAccountingPeriod(month, actor.email, client);
    const closedLock = await client.globalSettings.findUnique({ where: { key: "posting_lock_date" } });
    if (!closed.checklist.ready || closed.period.status !== "CLOSED" || closedLock?.value !== "2026-08-31") {
      throw new Error("Close UAT failed");
    }
    let duplicateCloseBlocked = false;
    try { await closeAccountingPeriod(month, actor.email, client); } catch { duplicateCloseBlocked = true; }
    if (!duplicateCloseBlocked) throw new Error("Duplicate close was not blocked");

    const reopened = await reopenAccountingPeriod(month, actor.email, "UAT verifies controlled reopen and prior lock restoration", client);
    const restoredLock = await client.globalSettings.findUnique({ where: { key: "posting_lock_date" } });
    const auditCount = await client.auditLog.count({ where: { entityType: "AccountingPeriod", entityCode: month, action: { in: ["CLOSE", "REOPEN"] } } });
    if (reopened.status !== "OPEN" || restoredLock?.value !== "2026-07-31" || auditCount !== 2) {
      throw new Error("Reopen UAT failed");
    }
    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      controlsPassed: closed.checklist.checks.filter((item) => item.severity === "PASS").length,
      warnings: closed.checklist.warningCount,
      closeStatus: closed.period.status,
      duplicateCloseBlocked,
      reopenStatus: reopened.status,
      priorLockRestored: restoredLock.value,
      auditRows: auditCount,
    }, null, 2));
  } finally {
    await client.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
