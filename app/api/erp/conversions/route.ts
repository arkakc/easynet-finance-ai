import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth";
import { POST as legacyPost } from "@/app/api/conversions/route";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "quoteToInvoice" | "poToBill"; payload?: unknown };
    if (!body.action) return NextResponse.json({ ok: false, error: "Conversion action is required" }, { status: 400 });
    await requirePermission(body.action === "quoteToInvoice" ? "sales.write" : "purchase.write");
    if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
    return legacyPost(new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, secret: env.APP_SECRET }),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
