import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getSetupOverview, markSetupStepComplete, postOpeningBalanceJournal, saveSetupConfig, validateOpeningBalances, type OpeningBalanceEntry } from "@/lib/accounting/setup-workflow";
import { prisma } from "@/src/lib/prisma";

export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json({ ok: true, ...(await getSetupOverview()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup workflow unavailable";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermission("settings.manage");
    const body = await request.json() as { action?: string; config?: unknown; entries?: OpeningBalanceEntry[]; completedStepIndex?: number };
    if (body.action === "save-config") return NextResponse.json({ ok: true, ...(await saveSetupConfig(body.config, actor.email, prisma, body.completedStepIndex)) });
    if (body.action === "validate-opening") {
      const current = await getSetupOverview();
      if ((!body.entries || body.entries.length === 0) && current.config.openingMode === "EXISTING_BUSINESS") {
        return NextResponse.json({ ok: false, error: "Existing business setup requires opening balances or controlled AR/AP, inventory and asset migration before validation." }, { status: 400 });
      }
      const openingEntries = body.entries || [];
      const result = await validateOpeningBalances(openingEntries);
      await prisma.globalSettings.upsert({ where: { key: "opening_validation_status" }, create: { key: "opening_validation_status", value: result.valid ? "VALID" : "INVALID", updatedBy: actor.email }, update: { value: result.valid ? "VALID" : "INVALID", updatedBy: actor.email, updatedAt: new Date() } });
      await prisma.globalSettings.upsert({ where: { key: "opening_validation_difference" }, create: { key: "opening_validation_difference", value: String(result.difference), updatedBy: actor.email }, update: { value: String(result.difference), updatedBy: actor.email, updatedAt: new Date() } });
      await prisma.globalSettings.upsert({ where: { key: "opening_balance_entries" }, create: { key: "opening_balance_entries", value: JSON.stringify(openingEntries), updatedBy: actor.email }, update: { value: JSON.stringify(openingEntries), updatedBy: actor.email, updatedAt: new Date() } });
      const openingJournal = result.valid ? await postOpeningBalanceJournal(openingEntries, actor.email) : null;
      const overview = result.valid ? await markSetupStepComplete(5, actor.email) : await getSetupOverview();
      return NextResponse.json({ ok: true, ...result, openingJournal, overview });
    }
    if (body.action === "mark-review-complete") {
      const overview = await getSetupOverview();
      if (!overview.readyForGoLive) return NextResponse.json({ ok: false, error: "Review cannot be saved until every readiness control is complete.", overview }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await markSetupStepComplete(6, actor.email)) });
    }
    if (body.action === "activate") {
      const overview = await getSetupOverview();
      if (!overview.readyForGoLive) return NextResponse.json({ ok: false, error: "Setup cannot be activated until company configuration, Chart of Accounts and balanced opening validation are complete.", overview }, { status: 400 });
      await prisma.globalSettings.upsert({ where: { key: "setup_status" }, create: { key: "setup_status", value: "ACTIVE", updatedBy: actor.email }, update: { value: "ACTIVE", updatedBy: actor.email, updatedAt: new Date() } });
      await markSetupStepComplete(7, actor.email);
      return NextResponse.json({ ok: true, ...(await getSetupOverview()), status: "ACTIVE" });
    }
    return NextResponse.json({ ok: false, error: "Unsupported setup workflow action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup workflow failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
