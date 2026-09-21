import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateDetailed,
  requireValidatedRequestPermission,
} from "@/lib/auth";
import {
  appendAuditEvent,
  requestAuditContext,
} from "@/lib/security/audit";
import {
  getMasterDataSummary,
  deleteCompanyMasterData,
} from "@/lib/company/delete-master-data";

const deleteMasterDataSchema = z.object({
  password: z.string().min(1, "Administrator password is required").max(200),
  confirmationPhrase: z.string().min(1, "Confirmation phrase is required"),
  preserveAdminUser: z.boolean().optional().default(true),
});

function responseStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to execute master data wipe";
  return {
    message,
    status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500,
  };
}

export async function GET(request: Request) {
  try {
    await requireValidatedRequestPermission(request, "security.manage");
    return NextResponse.json({ ok: true, summary: await getMasterDataSummary() });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireValidatedRequestPermission(request, "security.manage");
    const body = await request.json();
    const parsed = deleteMasterDataSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }

    const { password, confirmationPhrase, preserveAdminUser } = parsed.data;
    const context = requestAuditContext(request);
    const reauth = await authenticateDetailed(user.email, password);
    if (!reauth.ok) {
      try {
        await appendAuditEvent({
          action: "DELETE_COMPANY_MASTER_DATA_REAUTH",
          entityType: "Company",
          entityCode: "ALL_MASTER_DATA",
          description: "Factory reset re-authentication failed",
          outcome: reauth.reason === "LOCKED" ? "LOCKED" : "DENIED",
          actorEmail: user.email,
          userId: user.userId || null,
          metadata: { retryAfterSeconds: reauth.retryAfterSeconds },
          ...context,
        });
      } catch (auditError) {
        console.error("[factory-reset-reauth-audit-failed]", auditError);
      }
      const response = NextResponse.json(
        {
          ok: false,
          error: reauth.reason === "LOCKED"
            ? "Administrator account is temporarily locked after repeated failed re-authentication."
            : "Re-authentication failed: Invalid administrator password.",
        },
        { status: reauth.reason === "LOCKED" ? 429 : 401 },
      );
      if (reauth.retryAfterSeconds > 0) {
        response.headers.set("retry-after", String(reauth.retryAfterSeconds));
      }
      return response;
    }

    if (confirmationPhrase.trim().toUpperCase() !== "WIPE ALL MASTER DATA") {
      return NextResponse.json(
        {
          ok: false,
          error: 'Confirmation mismatch: You must type "WIPE ALL MASTER DATA" exactly to execute a complete master data reset.',
        },
        { status: 400 },
      );
    }

    const result = await deleteCompanyMasterData({
      adminUserId: user.userId,
      adminEmail: user.email,
      adminName: user.name,
      preserveAdminUser,
      ipAddress: context.ipAddress || undefined,
      userAgent: context.userAgent || undefined,
      requestId: context.requestId,
    });

    return NextResponse.json({
      ok: true,
      message: "All company master data and records have been successfully deleted.",
      wiped: result.wiped,
      auditId: result.auditId,
      redirectTo: "/setup/finance",
    });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}
