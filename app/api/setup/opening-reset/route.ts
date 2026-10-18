import { NextResponse } from "next/server";
import { requireConfigurationPermission, authenticateDetailed } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { backupBeforeReset } from "@/lib/accounting/setup-reset-backup";

export const runtime = "nodejs";
const OPENING_SOURCE = "SETUP_OPENING_BALANCES";
const CONFIRM = "RESET OPENING JOURNAL";

async function authorize() {
  const actor = await requireConfigurationPermission("security.manage");
  if (!actor.roles.includes("System Manager")) throw new Error("Forbidden: System Manager only");
  return actor;
}
async function inspect(tx = prisma) {
  const [status, journal, totalJournals, invoices, supplierBills, stockMovements, assetCount, payments, openingRows, approvals] = await Promise.all([
    tx.globalSettings.findUnique({ where: { key: "setup_status" } }),
    tx.journalHeader.findUnique({ where: { sourceDocId: OPENING_SOURCE }, include: { lines: { select: { id: true } } } }),
    tx.journalHeader.count(),
    tx.invoice.count(),
    tx.supplierBill.count(),
    tx.stockMovement.count(),
    tx.fixedAsset.count(),
    tx.payment.count(),
    tx.globalSettings.findUnique({ where: { key: "opening_balance_entries" } }),
    tx.approvalRequest.count(),
  ]);
  const blockers: string[] = [];
  if (status?.value?.toUpperCase() === "ACTIVE") blockers.push("Company accounting is already active");
  if (totalJournals > (journal ? 1 : 0)) blockers.push("Other journal entries exist");
  if ([invoices, supplierBills, stockMovements, assetCount, payments, approvals].some(Boolean)) blockers.push("Dependent invoices, bills, stock, assets, payments or approval records exist");
  if (journal && (journal.sourceDocType !== "OPENING" || journal.status !== "POSTED" || journal.reversalOfJournalId)) blockers.push("Opening journal is not an eligible original posted setup journal");
  if (journal && await tx.journalHeader.count({ where: { reversalOfJournalId: journal.id } })) blockers.push("A reversal already references the opening journal");
  return { eligible: blockers.length === 0, blockers, journal: journal ? { id: journal.id, code: journal.code, status: journal.status, debit: String(journal.totalDebit), credit: String(journal.totalCredit), lineCount: journal.lines.length } : null, hasSavedOpening: Boolean(openingRows?.value) };
}
function error(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Opening reset failed";
  return NextResponse.json({ ok: false, error: message }, { status: message.startsWith("Forbidden") ? 403 : 400 });
}
export async function GET() {
  try { await authorize(); return NextResponse.json({ ok: true, ...(await inspect()) }); }
  catch (reason) { return error(reason); }
}
export async function POST(request: Request) {
  try {
    const actor = await authorize();
    const body = await request.json() as { password?: string; confirmation?: string };
    if (body.confirmation !== CONFIRM || !body.password) return NextResponse.json({ ok: false, error: "Administrator password and exact confirmation required." }, { status: 400 });
    const verified = await authenticateDetailed(actor.email, body.password);
    if (!verified.ok || !verified.user.roles.includes("System Manager")) return NextResponse.json({ ok: false, error: "Administrator password verification failed." }, { status: 403 });
    const preflight = await inspect();
    if (!preflight.eligible) return NextResponse.json({ ok: false, error: "Reset blocked by related accounting records.", blockers: preflight.blockers }, { status: 409 });
    const backup = backupBeforeReset();
    await prisma.$transaction(async (tx) => {
      const live = await inspect(tx);
      if (!live.eligible || live.journal?.id !== preflight.journal?.id) throw new Error("Accounting records changed during reset; no data cleared.");
      if (live.journal) await tx.journalHeader.delete({ where: { id: live.journal.id } }); // Cascades exclusively into journal lines.
      await tx.globalSettings.deleteMany({ where: { key: { in: [
        "opening_validation_status", "opening_validation_difference", "opening_balance_entries",
        "opening_zero_confirmed", "opening_reconciliation_evidence"
      ] } } });
      await tx.globalSettings.upsert({ where: { key: "setup_completed_step_index" }, create: { key: "setup_completed_step_index", value: "4", updatedBy: actor.email }, update: { value: "4", updatedBy: actor.email, updatedAt: new Date() } });
      await tx.auditLog.create({ data: { action: "RESET", entityType: "OpeningJournal", entityId: live.journal?.id, entityCode: live.journal?.code, actorEmail: actor.email, description: "Administrator reset of first-time setup opening posting; snapshot retained in PostgreSQL backup", metadata: JSON.stringify({ backup: backup.fileName, journal: live.journal }) } });
    }, { isolationLevel: "Serializable", timeout: 30000 });
    return NextResponse.json({ ok: true, message: "Opening journal and Step 6 state reset. You can import and validate again.", backup });
  } catch (reason) { return error(reason); }
}
