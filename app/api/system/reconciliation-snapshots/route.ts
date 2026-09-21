import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import {
  compareFinancialReconciliationSnapshot,
  listFinancialReconciliationSnapshots,
  saveFinancialReconciliationSnapshot,
} from "@/lib/system/financial-reconciliation";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  z.object({ action: z.literal("compare"), fileName: z.string().trim() }),
]);

async function audit(email: string, action: string, fileName: string, changes: unknown) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return false;
  await prisma.auditLog.create({ data: {
    action,
    entityType: "FINANCIAL_RECONCILIATION",
    entityCode: fileName,
    description: action === "SNAPSHOT" ? "Created a financial migration reconciliation baseline" : "Compared current financial controls to a migration baseline",
    changes: JSON.stringify(changes),
    userId: user.id,
  } });
  return true;
}

export async function GET() {
  try {
    await requirePermission("settings.manage");
    const snapshots = await listFinancialReconciliationSnapshots();
    return NextResponse.json({ ok: true, snapshots: snapshots.map((snapshot) => ({
      fileName: snapshot.fileName,
      generatedAt: snapshot.generatedAt,
      generatedBy: snapshot.generatedBy,
      asOf: snapshot.asOf,
      fingerprint: snapshot.fingerprint,
      ledger: {
        totalDebit: snapshot.ledger.totalDebit,
        totalCredit: snapshot.ledger.totalCredit,
        difference: snapshot.ledger.difference,
      },
      receivables: snapshot.receivables.outstanding,
      payables: snapshot.payables.outstanding,
      inventoryValue: snapshot.inventory.estimatedValue,
      inventoryGlBalance: snapshot.inventory.glBalance,
      inventoryDifference: snapshot.inventory.difference,
      bankBookBalance: snapshot.banking.glBookBalance,
      bankReconciliationDrift: snapshot.banking.reconciliationDrift,
      controls: snapshot.controls,
    })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load reconciliation snapshots";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const body = actionSchema.parse(await request.json());
    if (body.action === "create") {
      const snapshot = await saveFinancialReconciliationSnapshot({ asOf: body.asOf, generatedBy: session.email });
      const auditRecorded = await audit(session.email, "SNAPSHOT", snapshot.fileName, { asOf: snapshot.asOf, fingerprint: snapshot.fingerprint, migrationReady: snapshot.controls.migrationReady }).catch(() => false);
      return NextResponse.json({ ok: true, message: auditRecorded ? "Financial reconciliation baseline created" : "Financial baseline created; audit log write needs review", auditRecorded, snapshot });
    }
    const comparison = await compareFinancialReconciliationSnapshot(body.fileName);
    const auditRecorded = await audit(session.email, "COMPARE", body.fileName, comparison).catch(() => false);
    return NextResponse.json({ ok: true, message: comparison.passed ? "All migration control totals match" : "Migration control differences need review", auditRecorded, comparison });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors.map((issue) => issue.message).join("; ") : error instanceof Error ? error.message : "Reconciliation action failed";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : /invalid|mismatch|YYYY/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
