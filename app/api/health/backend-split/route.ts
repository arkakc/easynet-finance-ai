import { NextResponse } from "next/server";
import { backendHealthAll } from "@/lib/backend/apps-script";

export async function GET() {
  try {
    const services = await backendHealthAll();
    const ok = Object.values(services).every((service) => service.ok);
    return NextResponse.json({ ok, services }, { status: ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Backend split health check failed" },
      { status: 503 },
    );
  }
}
