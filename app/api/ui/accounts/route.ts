import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";

export async function GET() {
  try {
    await requirePermission("accounts.read");
    const result = await listTable("Accounts", 500, 0);
    return NextResponse.json({ ok: true, accounts: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load accounts";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
