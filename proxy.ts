import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, verifySessionToken, type Permission } from "@/lib/auth";

const PUBLIC_EXACT_PATHS = ["/login", "/api/auth/login", "/api/health", "/api/backend/health"];
const LEGACY_WRITE_PATHS = [
  "/api/transactions",
  "/api/conversions",
  "/api/approvals",
  "/api/assets",
  "/api/budgets",
  "/api/masters",
  "/api/settings",
  "/api/stock",
  "/api/payment-schedules",
  "/api/loans/actions",
  "/api/journals/reverse",
  "/api/setup/finance",
  "/api/documents/extract",
];

const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/conversions/sales", "sales.write"],
  ["/conversions/purchase", "purchase.write"],
  ["/users", "users.manage"],
  ["/security", "security.manage"],
  ["/audit", "audit.read"],
  ["/settings", "settings.manage"],
  ["/system", "settings.manage"],
  ["/period-close", "post.approve"],
  ["/approvals", "post.approve"],
  ["/reports", "reports.read"],
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

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestId(request: NextRequest) {
  return request.headers.get("x-request-id") || crypto.randomUUID();
}

function applySecurityHeaders(response: NextResponse, id: string) {
  response.headers.set("x-request-id", id);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "same-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("x-permitted-cross-domain-policies", "none");
  response.headers.set(
    "content-security-policy",
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  );
  if (process.env.NODE_ENV === "production") {
    response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

function sameOriginMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/") || !MUTATING_METHODS.has(request.method)) return true;

  const fetchSite = String(request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function transactionRefererModule(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  if (!referer) return "";
  try {
    const url = new URL(referer);
    if (url.pathname !== "/transactions") return "";
    const module = url.searchParams.get("module") || "sales";
    return module === "purchase" || module === "expense" ? module : "sales";
  } catch {
    return "";
  }
}

function optimizedReadRewrite(request: NextRequest, id: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const module = transactionRefererModule(request);
  if (!module) return null;
  const pathname = request.nextUrl.pathname;

  if (pathname === "/api/erp/transactions" && !request.nextUrl.searchParams.has("nextNumberFor")) {
    const scope = module === "purchase" ? "purchaseModule" : module === "expense" ? "expenseModule" : "salesModule";
    const url = new URL(`/api/erp/transaction-list?scope=${scope}`, request.url);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-erp-scope", scope);
    requestHeaders.set("x-request-id", id);
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  if (pathname === "/api/masters") {
    const scope = module === "sales" ? "sales" : "purchase";
    const url = new URL(`/api/masters/scoped?scope=${scope}`, request.url);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-erp-scope", scope);
    requestHeaders.set("x-request-id", id);
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const id = requestId(request);

  if (!sameOriginMutation(request)) {
    return applySecurityHeaders(
      NextResponse.json({ ok: false, error: "Cross-site write request rejected" }, { status: 403 }),
      id,
    );
  }

  if (
    PUBLIC_EXACT_PATHS.includes(pathname)
    || pathname.startsWith("/_next/")
    || pathname === "/favicon.ico"
    || /\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(pathname)
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", id);
    return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), id);
  }

  const user = verifySessionToken(request.cookies.get(sessionCookie.name)?.value);
  if (!user) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
        id,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return applySecurityHeaders(NextResponse.redirect(url), id);
  }

  if (
    request.method !== "GET"
    && request.method !== "HEAD"
    && LEGACY_WRITE_PATHS.some((path) => pathname === path)
  ) {
    return applySecurityHeaders(
      NextResponse.json(
        { ok: false, error: "Direct legacy write endpoint disabled. Use user-authorized ERP action." },
        { status: 403 },
      ),
      id,
    );
  }

  const required = ROUTE_PERMISSIONS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )?.[1];

  if (required && !user.permissions.includes(required)) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }),
        id,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.set("denied", "1");
    return applySecurityHeaders(NextResponse.redirect(url), id);
  }

  const optimized = optimizedReadRewrite(request, id);
  if (optimized) return applySecurityHeaders(optimized, id);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", id);
  return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), id);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
