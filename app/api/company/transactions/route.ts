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
import { prisma } from "@/src/lib/prisma";
import {
  getCompanyTransactionsSummary,
  deleteCompanyTransactions,
} from "@/lib/company/delete-transactions";

const deleteRequestSchema = z.object({
  password: z.string().min(1, "Administrator password is required").max(200),
  companyNameConfirmation: z.string().min(1, "Company name confirmation is required"),
  resetStockQuantities: z.boolean().optional().default(true),
});

function responseStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to execute transaction wipe";
  return {
    message,
    status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500,
  };
}

export async function GET(request: Request) {
  try {
    await requireValidatedRequestPermission(request, "security.manage");
    const [summary, companySetting] = await Promise.all([
      getCompanyTransactionsSummary(),
      prisma.globalSettings.findUnique({ where: { key: "company_name" } }),
    ]);
    return NextResponse.json({
      ok: true,
      companyName: companySetting?.value || "Easynet IT Solutions Limited",
      summary,
    });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireValidatedRequestPermission(request, "security.manage");
    const body = await request.json();
    const parsed = deleteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }

    const { password, companyNameConfirmation, resetStockQuantities } = parsed.data;
    const context = requestAuditContext(request);
    const reauth = await authenticateDetailed(user.email, password);
    if (!reauth.ok) {
      try {
        await appendAuditEvent({
          action: "DELETE_COMPANY_TRANSACTIONS_REAUTH",
          entityType: "Company",
          entityCode: "ALL_TRANSACTIONS",
          description: "Transaction wipe re-authentication failed",
          outcome: reauth.reason === "LOCKED" ? "LOCKED" : "DENIED",
          actorEmail: user.email,
          userId: user.userId || null,
          metadata: { retryAfterSeconds: reauth.retryAfterSeconds },
          ...context,
        });
      } catch (auditError) {
        console.error("[transaction-wipe-reauth-audit-failed]", auditError);
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

    const companySetting = await prisma.globalSettings.findUnique({ where: { key: "company_name" } });
    const expectedCompanyName = (companySetting?.value || "Easynet IT Solutions Limited").trim();
    const normalizedConfirmation = companyNameConfirmation.trim();
    const confirmed =
      normalizedConfirmation.toLowerCase() === expectedCompanyName.toLowerCase()
      || normalizedConfirmation.toUpperCase() === "DELETE ALL TRANSACTIONS";

    if (!confirmed) {
      return NextResponse.json(
        {
          ok: false,
          error: `Confirmation mismatch: You must enter the exact company name "${expectedCompanyName}" or "DELETE ALL TRANSACTIONS" to confirm wipe.`,
        },
        { status: 400 },
      );
    }

    const result = await deleteCompanyTransactions({
      adminUserId: user.userId,
      adminEmail: user.email,
      adminName: user.name,
      resetStockQuantities,
      ipAddress: context.ipAddress || undefined,
      userAgent: context.userAgent || undefined,
      requestId: context.requestId,
    });

    return NextResponse.json({
      ok: true,
      message: "All company transactions have been successfully wiped.",
      wiped: result.wiped,
      auditId: result.auditId,
    });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}
