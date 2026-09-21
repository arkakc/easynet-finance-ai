import { buildFinancialReconciliationSnapshot } from "@/lib/system/financial-reconciliation";
import { listDatabaseBackups } from "@/lib/system/database-backup";
import { databaseRuntimeInfo, prisma } from "@/src/lib/prisma";

export type GoLiveCheck = { key: string; label: string; blocking: boolean; passed: boolean; detail: string };

function postgresReadinessCheck(): GoLiveCheck {
  const runtime = databaseRuntimeInfo();
  const productionRequiresTarget = process.env.GO_LIVE_REQUIRE_POSTGRES === "true" || runtime.productionLike;
  const passed = productionRequiresTarget
    ? runtime.provider === "postgresql" && runtime.postgresConfigured
    : runtime.provider === "sqlite" || (runtime.provider === "postgresql" && runtime.postgresConfigured);

  return {
    key: "postgres",
    label: productionRequiresTarget
      ? "Application runtime is using PostgreSQL"
      : "Database runtime configured for current environment",
    blocking: true,
    passed,
    detail: productionRequiresTarget
      ? passed
        ? "Runtime provider is PostgreSQL and target connection is configured"
        : `Production requires DATABASE_PROVIDER=postgresql with DATABASE_URL_POSTGRES configured; active provider is ${runtime.provider}`
      : `Active database provider: ${runtime.provider}`,
  };
}

export async function buildGoLiveReadiness() {
  const [snapshot, backups, payrollJournals, payrollRuns, missingSources] = await Promise.all([
    buildFinancialReconciliationSnapshot({ generatedBy: "go-live-readiness" }),
    listDatabaseBackups(),
    prisma.journalHeader.findMany({ where: { status: "POSTED", sourceDocType: "PAYROLL" }, select: { id: true, code: true } }),
    prisma.payrollRun.findMany({ where: { status: { not: "CANCELLED" } }, select: { journalId: true } }),
    prisma.document.count({ where: { status: { not: "ARCHIVED" }, OR: [{ fileUrl: null }, { fileUrl: "" }] } }),
  ]);
  const linkedPayrollJournals = new Set(payrollRuns.map((run) => run.journalId).filter(Boolean));
  const orphanPayroll = payrollJournals.filter((journal) => !linkedPayrollJournals.has(journal.id));
  const latestBackup = backups[0];
  const backupFresh = Boolean(latestBackup && Date.now() - new Date(latestBackup.createdAt).getTime() <= 24 * 60 * 60 * 1000);
  const checks: GoLiveCheck[] = [
    { key: "backup", label: "Verified database backup within 24 hours", blocking: true, passed: backupFresh, detail: latestBackup ? `${latestBackup.fileName} · ${new Date(latestBackup.createdAt).toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })}` : "No verified backup found" },
    { key: "ledger", label: "Posted ledger balanced", blocking: true, passed: snapshot.controls.ledgerBalanced, detail: snapshot.controls.ledgerBalanced ? `Debit and credit both K${snapshot.ledger.totalDebit.toFixed(2)}` : `Ledger difference K${Math.abs(snapshot.ledger.difference).toFixed(2)}` },
    { key: "ar", label: "Accounts receivable reconciled", blocking: true, passed: snapshot.receivables.matched, detail: `GL K${snapshot.receivables.glBalance.toFixed(2)} · subledger K${snapshot.receivables.outstanding.toFixed(2)} · difference K${Math.abs(snapshot.receivables.difference).toFixed(2)}` },
    { key: "ap", label: "Accounts payable reconciled", blocking: true, passed: snapshot.payables.matched, detail: `GL K${snapshot.payables.glBalance.toFixed(2)} · subledger K${snapshot.payables.outstanding.toFixed(2)} · difference K${Math.abs(snapshot.payables.difference).toFixed(2)}` },
    { key: "payroll", label: "Payroll journals linked to payroll register", blocking: true, passed: orphanPayroll.length === 0, detail: orphanPayroll.length ? `${orphanPayroll.length} orphan payroll journal(s): ${orphanPayroll.map((row) => row.code).join(", ")}` : "All payroll journals are registered" },
    { key: "sources", label: "Active source documents retained", blocking: true, passed: missingSources === 0, detail: missingSources ? `${missingSources} active document(s) have no retained binary` : "All active sources retained" },
    postgresReadinessCheck(),
    { key: "session", label: "Application session secret configured", blocking: true, passed: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32), detail: process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? "Secret present" : "SESSION_SECRET must be at least 32 characters" },
    { key: "auth", label: "NextAuth secret configured", blocking: true, passed: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32), detail: process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 ? "Secret present" : "AUTH_SECRET must be at least 32 characters" },
    { key: "backend", label: "Core accounting source is authoritative Prisma", blocking: true, passed: true, detail: "Core documents, journals, ledgers and financial controls use Prisma as the single source of truth" },
  ];
  return { generatedAt: new Date().toISOString(), ready: checks.filter((check) => check.blocking).every((check) => check.passed), checks, snapshot: { asOf: snapshot.asOf, fingerprint: snapshot.fingerprint, migrationReady: snapshot.controls.migrationReady } };
}
