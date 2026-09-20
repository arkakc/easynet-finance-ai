import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { applySubledgerRecovery, buildSubledgerRecoveryPreview } from "../lib/migration/subledger-recovery";
import { databasePath, verifyLiveDatabase } from "../lib/system/database-backup";
import { prisma } from "../src/lib/prisma";

async function ledgerControl(client: PrismaClient) {
  const [count, totals] = await Promise.all([
    client.journalHeader.count(),
    client.journalHeader.aggregate({ _sum: { totalDebit: true, totalCredit: true } }),
  ]);
  return { count, debit: Number(totals._sum.totalDebit || 0), credit: Number(totals._sum.totalCredit || 0) };
}

async function main() {
  await verifyLiveDatabase();
  const liveBefore = { invoices: await prisma.invoice.count(), bills: await prisma.supplierBill.count(), payments: await prisma.payment.count() };
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-subledger-recovery-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });
  const backupCalls = { count: 0 };
  const backupCallCount = () => backupCalls.count;
  try {
    const actor = await client.user.findFirst({ where: { status: "ACTIVE", role: "SYSTEM_MANAGER" } });
    if (!actor) throw new Error("UAT requires an active System Manager");
    const before = await buildSubledgerRecoveryPreview(client);
    const ready = before.candidates.filter((row) => row.eligible);
    if (ready.length !== 5 || before.summary.manual !== 2) throw new Error(`Expected 5 ready and 2 manual candidates, got ${ready.length} and ${before.summary.manual}`);
    if (before.summary.manualArOpening !== 45000 || before.summary.manualApOpening !== 42500) throw new Error("Opening balance safeguards did not classify the expected AR/AP amounts");
    const kinds = new Set(ready.map((row) => row.kind));
    for (const kind of ["SALES_INVOICE", "SUPPLIER_BILL", "CUSTOMER_RECEIPT", "SUPPLIER_PAYMENT"]) if (!kinds.has(kind as never)) throw new Error(`Missing ${kind} recovery candidate`);

    const receipt = ready.find((row) => row.kind === "CUSTOMER_RECEIPT");
    if (!receipt) throw new Error("Customer receipt candidate was not found");
    let dependencyBlocked = false;
    try {
      await applySubledgerRecovery({ candidateIds: [receipt.id], confirmation: "RECOVER 1 SUBLEDGER RECORDS", actorEmail: actor.email }, client, async () => { backupCalls.count += 1; return { fileName: "should-not-run.sqlite" }; });
    } catch (error) {
      dependencyBlocked = /requires/i.test(error instanceof Error ? error.message : "");
    }
    if (!dependencyBlocked || backupCallCount() !== 0) throw new Error("Payment dependency was not blocked before backup");

    const ledgerBefore = await ledgerControl(client);
    const result = await applySubledgerRecovery(
      { candidateIds: ready.map((row) => row.id), confirmation: `RECOVER ${ready.length} SUBLEDGER RECORDS`, actorEmail: actor.email },
      client,
      async () => { backupCalls.count += 1; return { fileName: "uat-verified-clone.sqlite" }; },
    );
    const ledgerAfter = await ledgerControl(client);
    if (JSON.stringify(ledgerAfter) !== JSON.stringify(ledgerBefore)) throw new Error("Recovery changed the posted GL");
    if (result.created.length !== 5 || backupCallCount() !== 1) throw new Error("Recovery did not create five records after one backup");
    const [invoiceCount, billCount, paymentCount] = await Promise.all([client.invoice.count(), client.supplierBill.count(), client.payment.count()]);
    if (invoiceCount !== liveBefore.invoices + 2 || billCount !== liveBefore.bills + 1 || paymentCount !== liveBefore.payments + 2) throw new Error("Recovered subledger counts are incorrect");
    const invoice = await client.invoice.findUnique({ where: { code: "INV-2026-0001" } });
    const bill = await client.supplierBill.findUnique({ where: { code: "BILL-2026-0001" } });
    if (invoice?.status !== "PAID" || Number(invoice.outstanding) !== 0 || bill?.status !== "PAID" || Number(bill.outstanding) !== 0) throw new Error("Recovered payment allocations are incorrect");
    const after = await buildSubledgerRecoveryPreview(client);
    if (after.summary.ready !== 0 || after.summary.recovered !== 5 || after.summary.manual !== 2) throw new Error("Idempotency scan did not mark recovered candidates correctly");
    if (after.controls.receivables.difference !== 45000 || after.controls.payables.difference !== 42500) throw new Error("Remaining control differences do not equal safeguarded opening balances");
    const [batchAudits, entityAudits] = await Promise.all([
      client.auditLog.count({ where: { entityType: "SUBLEDGER_RECOVERY", action: "RECOVER" } }),
      client.auditLog.count({ where: { entityType: { in: ["SALES_INVOICE", "SUPPLIER_BILL", "CUSTOMER_RECEIPT", "SUPPLIER_PAYMENT"] }, action: "RECOVER" } }),
    ]);
    if (batchAudits !== 1 || entityAudits !== 5) throw new Error("Recovery audit trail is incomplete");
    console.log(JSON.stringify({ database: "temporary clone", liveDatabaseChanged: false, readyCandidates: ready.length, recoveredRecords: result.created.length, verifiedBackupCreated: backupCallCount() === 1, paymentDependencyBlocked: dependencyBlocked, glUnchanged: true, remainingManualOpening: { ar: after.summary.manualArOpening, ap: after.summary.manualApOpening }, remainingDifference: { ar: after.controls.receivables.difference, ap: after.controls.payables.difference }, auditRows: batchAudits + entityAudits }, null, 2));
  } finally {
    await client.$disconnect();
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
    const liveAfter = { invoices: await prisma.invoice.count(), bills: await prisma.supplierBill.count(), payments: await prisma.payment.count() };
    if (JSON.stringify(liveAfter) !== JSON.stringify(liveBefore)) throw new Error("Live database changed during clone UAT");
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
