process.env.SESSION_SECRET = process.env.SESSION_SECRET || "easynet-preview-session-secret-change-before-production-2026";

import type { SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const admin: SessionUser = { email: "admin@easynet.local", name: "UAT Admin", roles: ["System Manager"], permissions: ROLE_PERMISSIONS["System Manager"] };
  const management: SessionUser = { email: "willie@easynet.local", name: "UAT Management", roles: ["Management"], permissions: ROLE_PERMISSIONS["Management"] };
  const cookie = (user: SessionUser) => ({ Cookie: `${sessionCookie.name}=${createSessionToken(user)}` });

  const unauthenticated = await fetch(`${baseUrl}/api/setup/workflow`);
  if (unauthenticated.status !== 401) throw new Error(`Unauthenticated setup GET expected 401, got ${unauthenticated.status}`);
  const denied = await fetch(`${baseUrl}/api/setup/workflow`, { headers: cookie(management) });
  if (denied.status !== 403) throw new Error(`Non-admin setup GET expected 403, got ${denied.status}`);
  const overview = await fetch(`${baseUrl}/api/setup/workflow`, { headers: cookie(admin) });
  if (!overview.ok) throw new Error(`Admin setup overview expected 200, got ${overview.status}`);
  const body = await overview.json() as { ok: boolean; metrics?: { coaCount?: number }; checks?: { chartOfAccounts?: boolean }; configurationReady?: boolean };
  if (!body.ok || !(body.metrics?.coaCount && body.metrics.coaCount > 0) || !body.checks?.chartOfAccounts) throw new Error("Setup overview did not recognise the imported Chart of Accounts");
  const unsupported = await fetch(`${baseUrl}/api/setup/workflow`, { method: "POST", headers: { ...cookie(admin), "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsupported" }) });
  if (unsupported.status !== 400) throw new Error(`Unsupported setup action expected 400, got ${unsupported.status}`);
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, unauthenticated: unauthenticated.status, nonAdmin: denied.status, adminOverview: overview.status, importedCoaRecognised: body.metrics?.coaCount, unsupportedAction: unsupported.status }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
