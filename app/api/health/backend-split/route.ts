import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { backendConfigStatus, backendHealthAll, CORE_DATA_AUTHORITY } from "@/lib/backend/apps-script";

export async function GET() {
  try {
    await requirePermission("settings.manage");
    const configuration = backendConfigStatus();
    const services = await backendHealthAll();

    // Reporting and document Apps Script services are optional integrations.
    // Core Prisma health alone determines whether the accounting system itself
    // is healthy. Optional integration failures are surfaced as warnings.
    const coreOk = services.core.ok;
    const integrationWarnings = (["reporting", "document"] as const)
      .filter((service) => configuration[service].source !== "unconfigured" && !services[service].ok)
      .map((service) => `${service}: ${services[service].error || "integration health check failed"}`);

    return NextResponse.json({
      ok: coreOk,
      coreAuthority: CORE_DATA_AUTHORITY,
      configuration,
      services,
      integrationWarnings,
    }, { status: coreOk ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backend health check failed";
    if (message === "Unauthorized" || message === "Forbidden") {
      return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 403 });
    }
    return NextResponse.json(
      {
        ok: false,
        coreAuthority: CORE_DATA_AUTHORITY,
        configuration: backendConfigStatus(),
        error: message,
      },
      { status: 503 },
    );
  }
}
