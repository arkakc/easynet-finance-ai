import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDetailed, createSessionToken, sessionCookie } from "@/lib/auth";
import {
  clearSuccessfulIdentityThrottle,
  loginThrottleStatus,
  recordLoginFailure,
} from "@/lib/security/auth-throttle";
import { appendAuditEvent, requestAuditContext } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

async function auditLogin(input: {
  request: Request;
  email: string;
  outcome: "SUCCESS" | "FAILURE" | "LOCKED";
  description: string;
  userId?: string | null;
  metadata?: unknown;
}) {
  const context = requestAuditContext(input.request);
  try {
    await appendAuditEvent({
      action: "LOGIN",
      entityType: "Security",
      entityId: input.userId || null,
      entityCode: input.email,
      actorEmail: input.email,
      userId: input.userId || null,
      description: input.description,
      outcome: input.outcome,
      metadata: input.metadata,
      ...context,
    });
  } catch (error) {
    console.error("[security-audit-login-failed]", error instanceof Error ? error.message : error);
  }
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const email = body.email.trim().toLowerCase();
    const context = requestAuditContext(request);

    const throttle = await loginThrottleStatus(context.ipAddress, email);
    if (throttle.blocked) {
      await auditLogin({
        request,
        email,
        outcome: "LOCKED",
        description: "Login attempt blocked by persistent throttle",
        metadata: { retryAfterSeconds: throttle.retryAfterSeconds },
      });
      const response = NextResponse.json(
        { ok: false, error: "Too many sign-in attempts. Try again later." },
        { status: 429 },
      );
      response.headers.set("retry-after", String(throttle.retryAfterSeconds));
      return response;
    }

    const result = await authenticateDetailed(email, body.password);
    if (!result.ok) {
      const recorded = await recordLoginFailure(context.ipAddress, email);
      const knownUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      const retryAfterSeconds = Math.max(result.retryAfterSeconds, recorded.retryAfterSeconds);
      const locked = result.reason === "LOCKED" || recorded.blocked;

      await auditLogin({
        request,
        email,
        userId: knownUser?.id || null,
        outcome: locked ? "LOCKED" : "FAILURE",
        description: locked ? "Login attempt locked after repeated failures" : "Invalid login attempt",
        metadata: { retryAfterSeconds },
      });

      const response = NextResponse.json(
        {
          ok: false,
          error: locked
            ? "Too many sign-in attempts. Try again later."
            : "Invalid email or password",
        },
        { status: locked ? 429 : 401 },
      );
      if (locked && retryAfterSeconds > 0) {
        response.headers.set("retry-after", String(retryAfterSeconds));
      }
      return response;
    }

    await clearSuccessfulIdentityThrottle(context.ipAddress, email);
    await auditLogin({
      request,
      email,
      userId: result.user.userId,
      outcome: "SUCCESS",
      description: "Successful local sign-in",
      metadata: { roles: result.user.roles },
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        email: result.user.email,
        name: result.user.name,
        roles: result.user.roles,
        permissions: result.user.permissions,
      },
    });
    response.cookies.set(sessionCookie.name, createSessionToken(result.user), {
      httpOnly: true,
      sameSite: sessionCookie.sameSite,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: sessionCookie.maxAge,
      priority: "high",
    });
    return response;
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "Enter a valid email and password"
      : error instanceof Error
        ? error.message
        : "Login failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
