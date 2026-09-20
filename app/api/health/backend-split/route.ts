import { NextResponse } from "next/server";
import { backendConfigStatus, backendHealthAll, CORE_DATA_AUTHORITY } from "@/lib/backend/apps-script";

export async function GET() {
  try {
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
    return NextResponse.json(
      {
        ok: false,
        coreAuthority: CORE_DATA_AUTHORITY,
        configuration: backendConfigStatus(),
        error: error instanceof Error ? error.message : "Backend health check failed",
      },
      { status: 503 },
    );
  }
}
