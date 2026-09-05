import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission, type Permission } from "@/lib/auth";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/transactions/route";

const ACTION_PERMISSION: Record<string, Permission> = {
  createQuote: "sales.write",
  createInvoice: "sales.write",
  createPurchaseOrder: "purchase.write",
  createSupplierBill: "purchase.write",
  createExpense: "purchase.write",
  createPayment: "accounts.write",
  post: "post.approve",
};

export async function GET() {
  try {
    await requirePermission("dashboard.read");
    return legacyGet();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : 401 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; payload?: unknown };
    const permission = body.action ? ACTION_PERMISSION[body.action] : undefined;
    if (!permission) return NextResponse.json({ ok: false, error: "Unsupported transaction action" }, { status: 400 });
    await requirePermission(permission);
    if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");

    const internal = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, secret: env.APP_SECRET }),
    });
    return legacyPost(internal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
