import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildFinancialStatements } from "../lib/accounting/financial-statements";
import { applyOpeningSchedule, buildOpeningSchedulePreview, getOpeningSubledgerPosition } from "../lib/migration/opening-subledger";
import { applySubledgerRecovery, buildSubledgerRecoveryPreview } from "../lib/migration/subledger-recovery";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";
import { prisma } from "../src/lib/prisma";

async function ledgerControl(client: PrismaClient) {
  const [count, totals] = await Promise.all([client.journalHeader.count(), client.journalHeader.aggregate({ _sum: { totalDebit: true, totalCredit: true } })]);
  return { count, debit: Number(totals._sum.totalDebit || 0), credit: Number(totals._sum.totalCredit || 0) };
}

async function main() {
  await verifyLiveDatabase();
  const liveBefore = { invoices: await prisma.invoice.count(), bills: await prisma.supplierBill.count(), payments: await prisma.payment.count(), audits: await prisma.auditLog.count({ where: { entityType: { in: ["OPENING_AR_SCHEDULE", "OPENING_AP_SCHEDULE"] } } }) };
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-opening-subledger-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });
  const backupCalls = { count: 0 };
  const backupCallCount = () => backupCalls.count;
  const backup = async () => ({ fileName: `uat-opening-backup-${++backupCalls.count}.sqlite` });
  try {
    const actor = await client.user.findFirst({ where: { status: "ACTIVE", role: "SYSTEM_MANAGER" } });
    const customers = await client.customer.findMany({ where: { code: { in: ["CUST-PNG-001", "CUST-PNG-002"] } }, orderBy: { code: "asc" } });
    const supplier = await client.supplier.findUnique({ where: { code: "SUP-HARDWARE-DIST" } });
    if (!actor || customers.length !== 2 || !supplier) throw new Error("UAT master data is incomplete");
    const arRows = [
      { "Document Code": "OB-AR-001", "Customer Code": customers[0].code, "Original Document Date": "2025-10-15", "Due Date": "2025-11-14", Outstanding: "25,000.00", Description: "Enterprise receivable carried forward" },
      { "Document Code": "OB-AR-002", "Customer Code": customers[1].code, "Original Document Date": "15/11/2025", "Due Date": "29/11/2025", Outstanding: "20000", Description: "Agriculture customer balance" },
    ];
    const apRows = [
      { "Document Code": "OB-AP-001", "Supplier Code": supplier.code, "Original Document Date": "2025-12-01", "Due Date": "2025-12-31", Outstanding: "42500.00", Description: "Hardware supplier balance" },
    ];
    const [arPosition, apPosition, arPreview, apPreview] = await Promise.all([
      getOpeningSubledgerPosition("ar", client), getOpeningSubledgerPosition("ap", client),
      buildOpeningSchedulePreview("ar", arRows, client), buildOpeningSchedulePreview("ap", apRows, client),
    ]);
    if (arPosition.remaining !== 45000 || apPosition.remaining !== 42500 || !arPreview.summary.ready || !apPreview.summary.ready) throw new Error("Opening control targets or valid previews are incorrect");
    const shortPreview = await buildOpeningSchedulePreview("ar", [{ ...arRows[0], Outstanding: "24000" }, arRows[1]], client);
    if (shortPreview.summary.ready || shortPreview.summary.difference !== 1000) throw new Error("Schedule total mismatch was not blocked");
    let confirmationBlocked = false;
    try { await applyOpeningSchedule({ entity: "ar", sourceRows: arRows, confirmation: "WRONG", actorEmail: actor.email, fileName: "ar.csv" }, client, backup); } catch (error) { confirmationBlocked = /type IMPORT OPENING AR/i.test(error instanceof Error ? error.message : ""); }
    if (!confirmationBlocked || backupCallCount() !== 0) throw new Error("Exact confirmation was not enforced before backup");

    const ledgerBefore = await ledgerControl(client);
    const arResult = await applyOpeningSchedule({ entity: "ar", sourceRows: arRows, confirmation: "IMPORT OPENING AR K45000.00", actorEmail: actor.email, fileName: "opening-ar.csv" }, client, backup);
    const apResult = await applyOpeningSchedule({ entity: "ap", sourceRows: apRows, confirmation: "IMPORT OPENING AP K42500.00", actorEmail: actor.email, fileName: "opening-ap.csv" }, client, backup);
    const ledgerAfterOpening = await ledgerControl(client);
    if (JSON.stringify(ledgerBefore) !== JSON.stringify(ledgerAfterOpening)) throw new Error("Opening schedule import changed the posted GL");
    if (arResult.created.length !== 2 || apResult.created.length !== 1 || backupCallCount() !== 2) throw new Error("Opening schedule rows or backups are incomplete");
    const preOpening = await buildFinancialStatements({ from: "2025-01-01", asOf: "2025-12-31" }, client);
    if (preOpening.controls.receivables.subledgerBalance !== 0 || preOpening.controls.payables.subledgerBalance !== 0) throw new Error("Opening rows leaked into pre-opening financial statements");
    const afterOpening = await buildFinancialStatements({ from: "1900-01-01", asOf: "2026-09-12" }, client);
    if (afterOpening.controls.receivables.subledgerBalance !== 45000 || afterOpening.controls.receivables.difference !== 22000 || !afterOpening.controls.payables.matched) throw new Error("Opening subledger did not reconcile to its carried-forward amounts");

    const recoveryPreview = await buildSubledgerRecoveryPreview(client);
    const recoverable = recoveryPreview.candidates.filter((row) => row.eligible);
    await applySubledgerRecovery({ candidateIds: recoverable.map((row) => row.id), confirmation: `RECOVER ${recoverable.length} SUBLEDGER RECORDS`, actorEmail: actor.email }, client, backup);
    const completed = await buildFinancialStatements({ from: "1900-01-01", asOf: "2026-09-12" }, client);
    if (!completed.controls.receivables.matched || !completed.controls.payables.matched) throw new Error("Combined opening import and journal recovery did not fully reconcile AR/AP");
    const duplicate = await buildOpeningSchedulePreview("ar", arRows, client);
    if (duplicate.summary.ready || duplicate.summary.invalid !== 2 || duplicate.position.remaining !== 0) throw new Error("Repeat import was not blocked as an idempotency control");
    const auditCount = await client.auditLog.count({ where: { entityType: { in: ["OPENING_AR_SCHEDULE", "OPENING_AP_SCHEDULE"] }, action: "IMPORT" } });
    if (auditCount !== 2) throw new Error("Opening schedule audit trail is incomplete");
    console.log(JSON.stringify({ database: "temporary clone", liveDatabaseChanged: false, openingTargets: { ar: arPosition.remaining, ap: apPosition.remaining }, importedRows: { ar: arResult.created.length, ap: apResult.created.length }, exactTotalControl: true, confirmationBlockedBeforeBackup: confirmationBlocked, preOpeningStatementsUnchanged: true, glUnchanged: true, combinedArReconciled: completed.controls.receivables.matched, combinedApReconciled: completed.controls.payables.matched, repeatImportBlocked: true, verifiedBackupHooks: backupCallCount(), auditRows: auditCount }, null, 2));
  } finally {
    await client.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
    const liveAfter = { invoices: await prisma.invoice.count(), bills: await prisma.supplierBill.count(), payments: await prisma.payment.count(), audits: await prisma.auditLog.count({ where: { entityType: { in: ["OPENING_AR_SCHEDULE", "OPENING_AP_SCHEDULE"] } } }) };
    if (JSON.stringify(liveAfter) !== JSON.stringify(liveBefore)) throw new Error("Live database changed during clone UAT");
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
