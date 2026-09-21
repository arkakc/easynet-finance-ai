import { NextResponse } from "next/server";
import { databaseRuntimeInfo, prisma } from "@/src/lib/prisma";

export async function GET() {
  const runtime = databaseRuntimeInfo();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return NextResponse.json({
      ok: true,
      service: "easynet-finance-ai",
      version: "1.0.0",
      database: {
        provider: runtime.provider,
        reachable: true,
      },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      service: "easynet-finance-ai",
      version: "1.0.0",
      database: {
        provider: runtime.provider,
        reachable: false,
      },
    }, { status: 503 });
  }
}
