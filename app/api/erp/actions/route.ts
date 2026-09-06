import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireRequestPermission, type Permission } from "@/lib/auth";
import { POST as approvalsPost } from "@/app/api/approvals/route";
import { POST as assetsPost } from "@/app/api/assets/route";
import { POST as budgetsPost } from "@/app/api/budgets/route";
import { POST as mastersPost } from "@/app/api/masters/route";
import { POST as settingsPost } from "@/app/api/settings/route";
import { POST as stockPost } from "@/app/api/stock/route";
import { POST as schedulesPost } from "@/app/api/payment-schedules/route";
import { POST as loanActionsPost } from "@/app/api/loans/actions/route";
import { POST as journalReversePost } from "@/app/api/journals/reverse/route";
import { POST as setupFinancePost } from "@/app/api/setup/finance/route";

type Target =
  | "approvals"
  | "assets"
  | "budgets"
  | "masters"
  | "settings"
  | "stock"
  | "paymentSchedules"
  | "loanActions"
  | "journalReverse"
  | "setupFinance";

type Handler = (request: Request) => Promise<Response>;

const HANDLERS: Record<Target, Handler> = {
  approvals: approvalsPost,
  assets: assetsPost,
  budgets: budgetsPost,
  masters: mastersPost,
  settings: settingsPost,
  stock: stockPost,
  paymentSchedules: schedulesPost,
  loanActions: loanActionsPost,
  journalReverse: journalReversePost,
  setupFinance: setupFinancePost,
};

function permissionFor(target: Target, body: Record<string, unknown>): Permission {
  if (target === "approvals" || target === "journalReverse") return "post.approve";
  if (target === "assets" || target === "stock") return "stock.write";
  if (target === "budgets" || target === "loanActions") return "accounts.write";
  if (target === "settings" || target === "setupFinance") return "settings.manage";
  if (target === "paymentSchedules") return "sales.write";
  if (target === "masters") {
    const type = String(body.type || "");
    if (type === "customer") return "sales.write";
    if (type === "supplier") return "purchase.write";
    return "settings.manage";
  }
  return "settings.manage";
}

export async function POST(request: Request) {
  try {
    const incoming = (await request.json()) as {
      target?: Target;
      body?: Record<string, unknown>;
    };

    if (!incoming.target || !HANDLERS[incoming.target]) {
      return NextResponse.json({ ok: false, error: "Unsupported ERP action target" }, { status: 400 });
    }

    const body = incoming.body || {};
    requireRequestPermission(request, permissionFor(incoming.target, body));

    if (!env.APP_SECRET) {
      throw new Error("Server compatibility credential is not configured");
    }

    const internalRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, secret: env.APP_SECRET }),
    });

    return HANDLERS[incoming.target](internalRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERP action failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
