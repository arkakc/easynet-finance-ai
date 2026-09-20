import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { applySubledgerRecovery, buildSubledgerRecoveryPreview } from "@/lib/migration/subledger-recovery";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const applySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1).max(100),
  confirmation: z.string().max(100),
});

function errorResponse(error: unknown) {
  const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : error instanceof Error ? error.message : "Subledger recovery failed";
  const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : /no longer|changed|requires/i.test(message) ? 409 : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    await requirePermission("settings.manage");
    const [preview, history] = await Promise.all([
      buildSubledgerRecoveryPreview(),
      prisma.auditLog.findMany({
        where: { entityType: "SUBLEDGER_RECOVERY", action: "RECOVER" },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      ...preview,
      history: history.map((row) => ({ id: row.id, backupFile: row.entityCode, description: row.description, details: row.changes ? JSON.parse(row.changes) : null, recoveredBy: row.user?.name || row.user?.email || "Unknown", createdAt: row.createdAt.toISOString() })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const body = applySchema.parse(await request.json());
    const result = await applySubledgerRecovery({
      ...body,
      actorEmail: session.email,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    });
    return NextResponse.json({ ok: true, message: `Recovered ${result.created.length} subledger record(s); posted GL was not changed`, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
