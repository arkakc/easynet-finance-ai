import { NextRequest, NextResponse } from "next/server";
import { Role as PrismaRole, UserStatus } from "@prisma/client";
import { z } from "zod";
import {
  listConfiguredUsers,
  requirePermission,
} from "@/lib/auth";
import { appendAuditEvent, requestAuditContext } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke_sessions"), userId: z.string().min(1) }),
  z.object({ action: z.literal("unlock"), userId: z.string().min(1) }),
  z.object({
    action: z.literal("set_status"),
    userId: z.string().min(1),
    status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVED"]),
  }),
  z.object({
    action: z.literal("set_role"),
    userId: z.string().min(1),
    role: z.enum([
      "SYSTEM_MANAGER",
      "FINANCE_CONTROLLER",
      "ACCOUNTS_USER",
      "SALES_USER",
      "PURCHASE_USER",
      "STOCK_USER",
      "MANAGEMENT",
      "AUDITOR",
    ]),
  }),
]);

function responseStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Security control failed";
  return {
    message,
    status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400,
  };
}

export async function GET() {
  try {
    await requirePermission("security.manage");
    return NextResponse.json({ ok: true, users: await listConfiguredUsers() });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requirePermission("security.manage");
    const body = actionSchema.parse(await request.json());
    const context = requestAuditContext(request);

    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: body.userId } });
      if (!target) throw new Error("User was not found");

      const removingLastSystemManager = async () => {
        if (target.role !== PrismaRole.SYSTEM_MANAGER || target.status !== UserStatus.ACTIVE) return false;
        const activeManagers = await tx.user.count({
          where: { role: PrismaRole.SYSTEM_MANAGER, status: UserStatus.ACTIVE },
        });
        return activeManagers <= 1;
      };

      let action = "SECURITY_USER_CHANGE";
      let description = "";
      let changes: Record<string, unknown> = {};
      let user = target;

      if (body.action === "revoke_sessions") {
        action = "SESSION_REVOKE";
        description = "All existing sessions revoked for user";
        changes = { sessionVersion: { from: target.sessionVersion, to: target.sessionVersion + 1 } };
        user = await tx.user.update({
          where: { id: target.id },
          data: { sessionVersion: { increment: 1 } },
        });
      } else if (body.action === "unlock") {
        action = "ACCOUNT_UNLOCK";
        description = "Login lock and failed-attempt counter cleared";
        changes = {
          failedLoginCount: { from: target.failedLoginCount, to: 0 },
          lockedUntil: { from: target.lockedUntil?.toISOString() || null, to: null },
        };
        user = await tx.user.update({
          where: { id: target.id },
          data: {
            failedLoginCount: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
          },
        });
      } else if (body.action === "set_status") {
        if (body.status !== "ACTIVE" && await removingLastSystemManager()) {
          throw new Error("The last active System Manager cannot be disabled");
        }
        action = "USER_STATUS_CHANGE";
        description = `User status changed from ${target.status} to ${body.status}`;
        changes = {
          status: { from: target.status, to: body.status },
          sessionVersion: { from: target.sessionVersion, to: target.sessionVersion + 1 },
        };
        user = await tx.user.update({
          where: { id: target.id },
          data: {
            status: body.status as UserStatus,
            sessionVersion: { increment: 1 },
          },
        });
      } else {
        if (body.role !== "SYSTEM_MANAGER" && await removingLastSystemManager()) {
          throw new Error("The last active System Manager cannot be demoted");
        }
        action = "USER_ROLE_CHANGE";
        description = `User role changed from ${target.role} to ${body.role}`;
        changes = {
          role: { from: target.role, to: body.role },
          sessionVersion: { from: target.sessionVersion, to: target.sessionVersion + 1 },
        };
        user = await tx.user.update({
          where: { id: target.id },
          data: {
            role: body.role as PrismaRole,
            sessionVersion: { increment: 1 },
          },
        });
      }

      await appendAuditEvent({
        action,
        entityType: "User",
        entityId: target.id,
        entityCode: target.email,
        actorEmail: actor.email,
        userId: actor.userId,
        description,
        changes,
        outcome: "SUCCESS",
        ...context,
      }, tx);

      return user;
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        status: updated.status,
        sessionVersion: updated.sessionVersion,
        failedLoginCount: updated.failedLoginCount,
        lockedUntil: updated.lockedUntil?.toISOString() || null,
      },
    });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}
