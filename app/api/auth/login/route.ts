import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, createSessionToken, sessionCookie } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = authenticate(body.email, body.password);
    if (!user) return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });

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
