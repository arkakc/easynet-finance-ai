process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'easynet-preview-session-secret-change-before-production-2026';
import type { Role, SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const makeHeaders = (role: Role) => {
    const user: SessionUser = { email: `${role.toLowerCase().replace(/\s+/g, ".")}@uat.local`, name: "UAT", roles: [role], permissions: ROLE_PERMISSIONS[role] };
    return { Cookie: `${sessionCookie.name}=${createSessionToken(user)}` };
  };
  const checks: Record<string, number> = {};
  const protectedRoutes: Array<[string, Role, Role]> = [["/api/assets", "System Manager", "Sales User"], ["/api/stock?scope=items", "System Manager", "Sales User"], ["/api/budgets", "System Manager", "Sales User"], ["/api/payment-schedules", "System Manager", "Stock User"]];
  for (const [path, managerRole, deniedRole] of protectedRoutes) {
    const unauthenticated = await fetch(`${baseUrl}${path}`);
    if (unauthenticated.status !== 401) throw new Error(`${path} unauthenticated expected 401, got ${unauthenticated.status}`);
    checks[`${path}:unauthenticated`] = unauthenticated.status;
    const denied = await fetch(`${baseUrl}${path}`, { headers: makeHeaders(deniedRole) });
    if (denied.status !== 403) throw new Error(`${path} ${deniedRole} expected 403, got ${denied.status}`);
    checks[`${path}:denied`] = denied.status;
    const manager = await fetch(`${baseUrl}${path}`, { headers: makeHeaders(managerRole) });
    if (!manager.ok) throw new Error(`${path} manager request failed with ${manager.status}`);
    const body = await manager.json();
    if (!body.ok) throw new Error(`${path} manager response was not ok`);
    checks[`${path}:manager`] = manager.status;
  }
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, routeChecks: checks }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
