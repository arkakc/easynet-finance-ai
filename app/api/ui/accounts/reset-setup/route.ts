import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { ALL_ERP_ACCOUNT_SETTING_FIELDS } from "@/lib/accounting/finance-settings";

// Never reset the COA after any financial activity or direct account linking.
export async function POST() {
  try {
    const actor = await requirePermission("accounts.write");
    const result = await prisma.$transaction(async (tx) => {
      const [status, journals, journalLines, banks, budgets, accounts] = await Promise.all([
        tx.globalSettings.findUnique({ where: { key: "setup_status" }, select: { value: true } }),
        tx.journalHeader.count(),
        tx.journalLine.count(),
        tx.bankAccount.count(),
        tx.budget.count(),
        tx.chartOfAccounts.count(),
      ]);
      if (status?.value?.toUpperCase() === "ACTIVE") throw new Error("COA reset is disabled after Go Live.");
      if (journals || journalLines || banks || budgets) {
        throw new Error("COA reset blocked: journals, bank accounts, or budgets exist. Existing financial records must be preserved.");
      }
      if (!accounts) return { deletedCount: 0 };
      // Detach hierarchy before removal; FK restrictions protect unexpected linked data.
      await tx.chartOfAccounts.updateMany({ data: { parentId: null } });
      const deleted = await tx.chartOfAccounts.deleteMany();
      const keys = [
        ...ALL_ERP_ACCOUNT_SETTING_FIELDS.map((field) => field.settingKey),
        "default_receivable_account", "default_payable_account", "default_cash_account",
        "default_bank_account", "retained_earnings_account", "round_off_account",
        "exchange_gain_loss_account", "opening_validation_status",
        "opening_validation_difference", "opening_balance_entries",
      ];
      await tx.globalSettings.deleteMany({ where: { key: { in: [...new Set(keys)] } } });
      await tx.globalSettings.upsert({
        where: { key: "setup_completed_step_index" },
        create: { key: "setup_completed_step_index", value: "1", updatedBy: actor.email },
        update: { value: "1", updatedBy: actor.email, updatedAt: new Date() },
      });
      const user = await tx.user.findUnique({ where: { email: actor.email.toLowerCase() }, select: { id: true } });
      if (!user) throw new Error("Account reset audit user could not be identified.");
      await tx.auditLog.create({
        data: {
          action: "DELETE", entityType: "ChartOfAccounts", entityCode: "SETUP_COA_RESET",
          description: `Setup COA reset by ${actor.email}: ${deleted.count} accounts removed.`,
          changes: JSON.stringify({ deletedCount: deleted.count, reason: "Recreate Chart of Accounts during setup" }),
          userId: user.id,
        },
      });
      return { deletedCount: deleted.count };
    }, { timeout: 20000 });
    return NextResponse.json({ ok: true, message: `COA reset complete: ${result.deletedCount} accounts removed. You can now import or create a new COA.`, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "COA reset failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 409 });
  }
}
