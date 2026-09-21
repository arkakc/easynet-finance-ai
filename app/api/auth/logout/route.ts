import { NextResponse } from "next/server";
import { getCurrentUser, sessionCookie } from "@/lib/auth";
import { appendAuditEvent, requestAuditContext } from "@/lib/security/audit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user) {
    const context = requestAuditContext(request);
    try {
      await appendAuditEvent({
        action: "LOGOUT",
        entityType: "Security",
        entityId: user.userId,
        entityCode: user.email,
        actorEmail: user.email,
        userId: user.userId,
        description: "User signed out",
        outcome: "SUCCESS",
        ...context,
      });
    } catch (error) {
      console.error("[security-audit-logout-failed]", error instanceof Error ? error.message : error);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie.name, "", {
    httpOnly: true,
    sameSite: sessionCookie.sameSite,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
  return response;
}
