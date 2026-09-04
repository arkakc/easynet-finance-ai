import { NextResponse } from "next/server";
import { backendHealth } from "@/lib/backend/apps-script";

export async function GET() {
  try {
    const result = await backendHealth();

    return NextResponse.json({
      ok: true,
      frontend: "easynet-finance-ai",
      backend: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        frontend: "easynet-finance-ai",
        error: error instanceof Error ? error.message : "Unknown backend health error",
      },
      { status: 503 },
    );
  }
}
