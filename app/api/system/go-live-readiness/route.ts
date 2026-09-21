import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getSetupGateState } from "@/lib/setup-gate";
import { buildGoLiveReadiness } from "@/lib/system/go-live-readiness";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("settings.manage");
    const [readiness, gate] = await Promise.all([buildGoLiveReadiness(), getSetupGateState()]);
    return NextResponse.json({ ok: true, openingSubledgerLocked: gate.openingSubledgerLocked, ...readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Go-live readiness check failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
