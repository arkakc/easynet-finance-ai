import { backupBeforeReset } from "@/lib/accounting/setup-reset-backup";
import { NextResponse } from "next/server";
import { requireConfigurationPermission, authenticateDetailed } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { SETUP_KEYS } from "@/lib/accounting/setup-workflow";

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
