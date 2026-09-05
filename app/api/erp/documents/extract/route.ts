import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth";
import { POST as legacyExtractPost } from "@/app/api/documents/extract/route";

export async function POST(request: Request) {
  try {
    await requirePermission("accounts.write");
    if (!env.APP_SECRET) throw new Error("Server compatibility credential is not configured");

    const formData = await request.formData();
    formData.set("secret", env.APP_SECRET);

    const internalRequest = new Request(request.url, {
      method: "POST",
      body: formData,
    });

    return legacyExtractPost(internalRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document intake failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
