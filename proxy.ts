import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, verifySessionToken, type Permission } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health", "/api/backend/health"];

const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/users", "users.manage"],
  ["/api/settings", "settings.manage"],
  ["/settings", "settings.manage"],
  ["/api/approvals", "post.approve"],
  ["/approvals", "post.approve"],
  ["/reports", "reports.read"],
  ["/api/stock", "stock.read"],
  ["/stock", "stock.read"],
  ["/assets", "stock.read"],
  ["/accounts", "accounts.read"],
  ["/journals", "accounts.read"],
  ["/loans", "accounts.read"],
  ["/statements", "accounts.read"],
  ["/budgets", "accounts.read"],
  ["/documents", "accounts.read"],
  ["/ai-finance", "accounts.read"],
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const user = verifySessionToken(request.cookies.get(sessionCookie.name)?.value);
  if (!user) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const required = ROUTE_PERMISSIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
  if (required && !user.permissions.includes(required)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
