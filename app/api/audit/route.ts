import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { verifyAuditIntegrity } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  action: z.string().trim().max(80).optional(),
  outcome: z.string().trim().max(40).optional(),
  entityType: z.string().trim().max(80).optional(),
  actorEmail: z.string().trim().max(320).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requirePermission("audit.read");
    const parsed = querySchema.parse({
      limit: request.nextUrl.searchParams.get("limit") || 100,
      action: request.nextUrl.searchParams.get("action") || undefined,
      outcome: request.nextUrl.searchParams.get("outcome") || undefined,
      entityType: request.nextUrl.searchParams.get("entityType") || undefined,
      actorEmail: request.nextUrl.searchParams.get("actorEmail") || undefined,
    });

    const where = {
      ...(parsed.action ? { action: parsed.action.toUpperCase() } : {}),
      ...(parsed.outcome ? { outcome: parsed.outcome.toUpperCase() } : {}),
      ...(parsed.entityType ? { entityType: parsed.entityType } : {}),
      ...(parsed.actorEmail ? { actorEmail: parsed.actorEmail.toLowerCase() } : {}),
    };

    const [entries, integrity] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: parsed.limit,
        select: {
          id: true,
          createdAt: true,
          action: true,
          outcome: true,
          entityType: true,
          entityId: true,
          entityCode: true,
          description: true,
          changes: true,
          metadata: true,
          actorEmail: true,
          userId: true,
          ipAddress: true,
          userAgent: true,
          requestId: true,
          previousHash: true,
          integrityHash: true,
        },
      }),
      verifyAuditIntegrity(),
    ]);

    return NextResponse.json({
      ok: true,
      integrity,
      entries: entries.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        sealed: Boolean(row.integrityHash),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit trail could not be loaded";
    const status = message === "Unauthorized"
      ? 401
      : message === "Forbidden"
        ? 403
        : error instanceof z.ZodError
          ? 400
          : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
