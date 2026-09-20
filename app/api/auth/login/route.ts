import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, createSessionToken, sessionCookie } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

const schema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await authenticate(body.email, body.password);
    if (!user) return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });

    // Login auditing is deliberately best-effort: an audit write must never lock
    // an authorised user out when the local database is temporarily unavailable.
    try {
      const dbUser = await prisma.user.findUnique({ where: { email: user.email } });
      if (dbUser) {
        await prisma.auditLog.create({
          data: {
            action: "LOGIN",
            entityType: "User",
            entityId: dbUser.id,
            entityCode: dbUser.email,
            description: "Successful local sign-in",
            userId: dbUser.id,
            ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
            userAgent: request.headers.get("user-agent") || null,
          },
        });
      }
    } catch {
      // Authentication succeeds even if audit storage is unavailable.
    }

    const response = NextResponse.json({ ok: true, user });
    response.cookies.set(sessionCookie.name, createSessionToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: sessionCookie.maxAge,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Login failed" }, { status: 400 });
  }
}
