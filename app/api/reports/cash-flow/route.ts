import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { buildCashFlowStatement } from "@/lib/accounting/cash-flow";
import { configuredFiscalYearStart } from "@/lib/accounting/financial-statements";

export const runtime = "nodejs";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(request: NextRequest) {
  try {
    await requirePermission("reports.read");
    const query = querySchema.parse({ from: request.nextUrl.searchParams.get("from") || undefined, asOf: request.nextUrl.searchParams.get("asOf") });
    const from = query.from || await configuredFiscalYearStart(query.asOf);
    return NextResponse.json({ ok: true, statement: await buildCashFlowStatement({ from, asOf: query.asOf }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build cash-flow statement";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : error instanceof z.ZodError || /date|from/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
