import { NextResponse } from "next/server";
import { requireConfigurationPermission, authenticateDetailed } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { SETUP_KEYS } from "@/lib/accounting/setup-workflow";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
const CONFIRMATION = "RESET FINANCE SETUP";
let resetInProgress = false;

async function inspect() {
  const [setup, journals, invoices, bills, movements, customers, suppliers, items, assets, banks, accounts] = await Promise.all([
    prisma.globalSettings.findUnique({ where: { key: "setup_status" } }),
    prisma.journalHeader.count(),
    prisma.invoice.count(),
    prisma.supplierBill.count(),
    prisma.stockMovement.count(),
    prisma.customer.count(),
    prisma.supplier.count(),
    prisma.item.count(),
    prisma.fixedAsset.count(),
    prisma.bankAccount.count(),
    prisma.chartOfAccounts.count(),
  ]);
  const dependencies = { journals, invoices, bills, movements, customers, suppliers, items, assets, banks };
  const blockers = Object.entries(dependencies).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`);
  if (String(setup?.value || "").toUpperCase() === "ACTIVE") blockers.push("Finance setup already active");
  return { eligible: blockers.length === 0, blockers, accounts, dependencies, setupStatus: setup?.value || "NEW_INSTALLATION" };
}

export function backupBeforeReset() {
  const url = process.env.DATABASE_URL_POSTGRES;
  if (!url) throw new Error("PostgreSQL connection is not configured.");
  const database = new URL(url);
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Only PostgreSQL reset is supported.");
  const name = decodeURIComponent(database.pathname.slice(1));
  if (!name) throw new Error("Missing PostgreSQL database name.");
  const binaryDir = process.env.POSTGRES_BIN_DIR || (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin" : "");
  const binary = (base: string) => binaryDir ? path.join(binaryDir, process.platform === "win32" ? base + ".exe" : base) : base;
  const env = { ...process.env, PGHOST: database.hostname, PGPORT: database.port || "5432", PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password), PGDATABASE: name };
  const directory = path.resolve("backups", "postgresql");
  mkdirSync(directory, { recursive: true });
  const backupPath = path.join(directory, `finance-setup-pre-reset-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.dump`);
  const dump = spawnSync(binary("pg_dump"), ["--format=custom", "--file", backupPath, "--no-password"], { env, encoding: "utf8", windowsHide: true });
  if (dump.error || dump.status !== 0) throw new Error(`PostgreSQL backup failed: ${String(dump.stderr || dump.error || "").slice(0, 500)}`);
  const check = spawnSync(binary("pg_restore"), ["--list", backupPath], { env, encoding: "utf8", windowsHide: true });
  if (check.error || check.status !== 0 || !check.stdout?.includes("TABLE")) throw new Error("Backup verification failed; no reset performed.");
  const size = statSync(backupPath).size;
  if (size < 1024) throw new Error("Backup too small; reset blocked.");
  const sha256 = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
  writeFileSync(backupPath + ".json", JSON.stringify({ purpose: "finance-setup-reset", database: name, createdAt: new Date().toISOString(), sha256, size, verification: "pg_restore --list passed; restoration not independently verified" }, null, 2));
  return { fileName: path.basename(backupPath), sha256 };
}

async function authorize() {
  const actor = await requireConfigurationPermission("security.manage");
  if (!actor.roles.includes("System Manager")) throw new Error("Only an active System Manager can reset finance setup.");
  return actor;
}
function error(error: unknown) {
  const message = error instanceof Error ? error.message : "Finance setup reset error";
  return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
}
export async function GET() {
  try { await authorize(); return NextResponse.json({ ok: true, ...(await inspect()) }); }
  catch (reason) { return error(reason); }
}
export async function POST(request: Request) {
  try {
    const actor = await authorize();
    const body = await request.json() as { password?: string; confirmation?: string };
    if (body.confirmation !== CONFIRMATION || !body.password) return NextResponse.json({ ok: false, error: "Administrator password and exact reset confirmation required." }, { status: 400 });
    const reverified = await authenticateDetailed(actor.email, body.password);
    if (!reverified.ok || !reverified.user.roles.includes("System Manager")) return NextResponse.json({ ok: false, error: "Administrator re-verification failed." }, { status: 403 });
    if (resetInProgress) return NextResponse.json({ ok: false, error: "A setup reset is already in progress." }, { status: 409 });
    resetInProgress = true;
    try {
      const preflight = await inspect();
      if (!preflight.eligible) return NextResponse.json({ ok: false, error: "Reset blocked because dependent or posted records exist. Use controlled reversal and resolve dependent records first.", blockers: preflight.blockers }, { status: 409 });
      const backup = backupBeforeReset();
      await prisma.$transaction(async (tx) => {
        // Recheck inside the transaction; existing financial activity is never erased.
        const [journals, invoices, bills, movements, customers, suppliers, items, assets, banks] = await Promise.all([
          tx.journalHeader.count(), tx.invoice.count(), tx.supplierBill.count(), tx.stockMovement.count(),
          tx.customer.count(), tx.supplier.count(), tx.item.count(), tx.fixedAsset.count(), tx.bankAccount.count(),
        ]);
        if ([journals, invoices, bills, movements, customers, suppliers, items, assets, banks].some(Boolean)) throw new Error("Dependent financial or master records appeared; reset aborted.");
        const state = await tx.globalSettings.findUnique({ where: { key: "setup_status" } });
        if (state?.value?.toUpperCase() === "ACTIVE") throw new Error("Finance setup is ACTIVE; reset blocked.");
        await tx.globalSettings.deleteMany({ where: { key: { in: [...SETUP_KEYS] } } });
        await tx.globalSettings.create({ data: { key: "setup_completed_step_index", value: "-1", updatedBy: actor.email } });
      }, { isolationLevel: "Serializable" });
      return NextResponse.json({ ok: true, message: "Finance setup configuration reset. Chart of Accounts and administrator accounts were preserved. Refresh to start at Step 1.", backup });
    } finally { resetInProgress = false; }
  } catch (reason) { return error(reason); }
}
