import { prisma } from "@/src/lib/prisma";
import { SETUP_FINAL_STEP_INDEX } from "@/lib/accounting/setup-workflow";

export async function getSetupGateState() {
  try {
    const rows = await prisma.globalSettings.findMany({
      where: { key: { in: ["setup_status", "setup_completed_step_index", "opening_mode"] } },
      select: { key: true, value: true },
    });
    const settings = new Map(rows.map((row) => [row.key, row.value || ""]));
    const status = String(settings.get("setup_status") || "NEW_INSTALLATION").toUpperCase();
    const completedStepIndex = Number(settings.get("setup_completed_step_index") || -1);
    const openingMode = String(settings.get("opening_mode") || "NEW_BUSINESS").toUpperCase();
    const setupActive = status === "ACTIVE" && Number.isFinite(completedStepIndex) && completedStepIndex >= SETUP_FINAL_STEP_INDEX;
    return { status, setupActive, openingMode, openingSubledgerLocked: setupActive && openingMode === "NEW_BUSINESS" };
  } catch {
    return { status: "NEW_INSTALLATION", setupActive: false, openingMode: "NEW_BUSINESS", openingSubledgerLocked: false };
  }
}
