import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { buildTrialBalance } from "@/lib/accounting/trial-balance";

export const runtime = "nodejs";

/** Posted-ledger trial balance. All values are in the configured company base currency. */
export async function GET(request: NextRequest) {
  try {
    await requirePermission("reports.read");
    const asOf = request.nextUrl.searchParams.get("asOf") || new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Port_Moresby",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const startDate = request.nextUrl.searchParams.get("startDate") || undefined;
    const trialBalance = await buildTrialBalance({ startDate, asOf });
    return NextResponse.json({ ok: true, trialBalance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build trial balance";
    const status = message === "Unauthorized"
      ? 401
      : message === "Forbidden"
        ? 403
        : /date|startDate/i.test(message)
          ? 400
          : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
