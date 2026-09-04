import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { bootstrapFinanceMasterData } from "@/lib/accounting/bootstrap-finance";

export async function POST(request: Request) {
  try {
    if (!env.APP_SECRET) {
      return NextResponse.json(
        { ok: false, error: "APP_SECRET is not configured" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { secret?: string };
    if (!body.secret || body.secret !== env.APP_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const result = await bootstrapFinanceMasterData();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Finance bootstrap failed",
      },
      { status: 500 },
    );
  }
}
