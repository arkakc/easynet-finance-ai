process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'easynet-preview-session-secret-change-before-production-2026';
import type { SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const user: SessionUser = { email: "admin@easynet.local", name: "UAT", roles: ["System Manager"], permissions: ROLE_PERMISSIONS["System Manager"] };
  const headers = { Cookie: `${sessionCookie.name}=${createSessionToken(user)}` };
  const unauthenticated = await fetch(`${baseUrl}/api/system/go-live-readiness`);
  if (unauthenticated.status !== 401) throw new Error(`Unauthenticated readiness expected 401, got ${unauthenticated.status}`);
  const response = await fetch(`${baseUrl}/api/system/go-live-readiness`, { headers });
  if (!response.ok) throw new Error(`Readiness API failed with ${response.status}: ${await response.text()}`);
  const body = await response.json();
  if (body.ready !== false) throw new Error("Readiness unexpectedly reports READY with unresolved live controls");
  if (!Array.isArray(body.checks)) throw new Error("Readiness did not return its control checks");
  // A fresh company legitimately has zero AR/AP and therefore passes those
  // reconciliations. Infrastructure blockers must still be visible before
  // production cutover when the local environment has no migration target.
  if (!body.checks.some((check: { key: string; passed: boolean }) => check.key === "postgres" && !check.passed)) throw new Error("Readiness did not expose the missing PostgreSQL target blocker");
  if (!body.checks.some((check: { key: string }) => check.key === "auth")) throw new Error("Readiness did not validate the NextAuth secret");
  if (!body.checks.some((check: { key: string }) => check.key === "session")) throw new Error("Readiness did not validate the application session secret");
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, unauthenticated: unauthenticated.status, authenticated: response.status, ready: body.ready, failedBlockingChecks: body.checks.filter((check: { blocking: boolean; passed: boolean }) => check.blocking && !check.passed).map((check: { key: string; detail: string }) => ({ key: check.key, detail: check.detail })) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
