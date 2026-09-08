import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { backendHealthAll, listReportingTable } from "@/lib/backend/apps-script";

type DashboardKPI = { key: string; value: string | number; updatedAt: string };

export async function GET() {
  try {
    await requirePermission("dashboard.read");

    const [reportingResult, healthResult] = await Promise.allSettled([
      listReportingTable<DashboardKPI>("ReportDashboardKPI", 100, 0),
      backendHealthAll(),
    ]);

    const rows = reportingResult.status === "fulfilled" ? reportingResult.value.rows : [];
    const services = healthResult.status === "fulfilled" ? healthResult.value : {};
    let backendError = "";

    if (reportingResult.status === "rejected") {
      backendError = reportingResult.reason instanceof Error
        ? reportingResult.reason.message
        : "Reporting backend read failed";
    } else if (!rows.length) {
      backendError = "Reporting summary is empty. Refresh the Reporting database materializer.";
    }

    return NextResponse.json({ ok: true, rows, services, backendError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard data load failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}
